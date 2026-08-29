# 部署到阿里云 ECS

面向 10 人以内的课题组。整套东西是 nginx + uvicorn + sqlite，没有 Redis、没有消息队列，
出问题时能一个人看懂。

## 0. 先办的两件事

**域名备案。** 中国大陆节点的 ECS 绑域名必须先完成 ICP 备案，否则 80/443 进不来。
个人备案通常 1–3 周，**建议现在就去起流程**，它大概率比代码更晚就绪。
不想备案的话有两个选择：用香港/新加坡节点，或者先用 `http://<公网IP>:5299` 直连测试——
但那样没有 TLS，**不要在上面让学生输真实口令**。

**买什么机器。** 阿里云有两个产品线，课题组这个规模选**轻量应用服务器**就够了——
带宽和流量打包在里面，控制台简单，比同配置的 ECS 便宜。ECS 更灵活，但要自己管
带宽计费和安全组，对这个场景是多余的复杂度。

下单前把这几项对一遍：

| 项目 | 最低 | 说明 |
| --- | --- | --- |
| CPU / 内存 | **2 核 2G** | 1G 跑不起来。内存是唯一真正的瓶颈，见下一段 |
| 系统盘 | **40 GB** | 合同原件和每日备份会累积，20G 用一两年就紧张 |
| 带宽 | **3–5 Mbps** | 十来个人内部用，够了。合同上传是偶发的 |
| 月流量包 | 留意配额 | 轻量服务器超了会限速，不是停机。正常使用远用不完 |
| 镜像 | **Ubuntu 22.04 / 24.04 LTS** | 或 Alibaba Cloud Linux 3。部署脚本这几个都认 |
| 购买时长 | **≥ 3 个月** | 想通过阿里云备案的话这是硬性要求，买 1 个月拿不到备案服务号 |
| 地域 | 离学校近的节点 | 不打算备案就选香港/新加坡，代价是访问稍慢 |

再开一下**自动快照**（轻量服务器控制台里就有）。它和应用自己的备份是两回事：
快照救的是「整台机器搞坏了」，应用备份救的是「数据删错了」，两个都要。

**别开的**：负载均衡、CDN、RDS 数据库——这套东西用不上，纯属多花钱。

**选机型：2C2G 够用。**

Web 层实测过：10 个账号并发（20 学生 / 600 条周进展的库），吞吐 593 req/s，
`/api/state` 中位 14ms，**内存峰值 90MB**。10 个真人点页面离这个上限还差三个数量级。

OCR 不影响这个结论——它跑在**独立子进程**里，用完就退出，内存由内核收回，
web 进程始终维持在 ~90MB。默认引擎是 RapidOCR（和 PaddleOCR 是同一套 PP-OCR 模型，
但推理走 onnxruntime，轻得多）。

2C2G 的内存账大致是：系统 ~300MB + web ~90MB + OCR 子进程（瞬时，跑完就还）。
**务必配 2GB swap 兜底**（见下一步），OCR 峰值撞上来时不至于被 OOM Killer 杀进程。

只放行 **80 / 443 / 22**（轻量服务器叫「防火墙」，ECS 叫「安全组」）。
5299 是 uvicorn 的本地端口，**不要**对公网开放。

## 0.5 配 swap（2C2G 必做）

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
# 优先用物理内存，swap 只做兜底
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
free -h
```

阿里云的系统盘默认没有 swap，这一步不做的话，OCR 峰值时内核会随机杀进程——
被杀的很可能是 uvicorn 或 nginx，而不是真正吃内存的那个。

## 1. 一键部署（推荐）

把仓库放到服务器上，然后一条命令：

```bash
sudo bash deploy/install.sh
```

它会依次做完：装系统包、配 2GB swap、建服务账号和数据目录、装 Python 依赖、
按机器内存自动定 argon2 和 OCR 的内存参数、生成 systemd 与 nginx 配置、
申请 Let's Encrypt 证书、挂上每日备份、引导你建第一个管理员账号，最后跑一次自检。

中途会问三件事：域名（留空则用 IP 裸跑测试）、要不要装 OCR、管理员账号和口令。

域名这一项会决定会话 Cookie 带不带 `Secure`——浏览器不会在明文 HTTP 上保存
Secure Cookie，配错了的表现是「登录成功后立刻被弹回登录页」，很难查。脚本会
按你填的域名自动设对；证书申请失败时也会自动降回去并提示你。

**脚本可以重复运行。** 失败了或想改配置，重跑一次即可，不会动已有的数据库。

脚本做不了的三件事，必须你先自己完成：**ICP 备案**（1–3 周人工审核）、
**买服务器和域名**、**把域名解析到这台机器**。脚本不碰你的阿里云 AccessKey——
一个泄露的 AccessKey 能开关你账号下所有资源，风险远大于省下的那几次点击。

下面第 2 节起是手动步骤，用脚本的话可以跳到第 6 节的检查清单。

## 2. 手动装依赖

```bash
sudo useradd -r -m -d /var/lib/lab-bench -s /usr/sbin/nologin labbench
sudo mkdir -p /opt/lab-bench /var/lib/lab-bench/uploads
sudo chown -R labbench:labbench /var/lib/lab-bench
```

把仓库放到 `/opt/lab-bench`，然后：

```bash
cd /opt/lab-bench
python3 -m venv .venv
.venv/bin/pip install -r server/requirements.txt
```

`requirements.txt` 默认装的 OCR 引擎是 `rapidocr-onnxruntime`，适合 2C2G。
只处理数字版合同（Word 导出、电子签生成的 PDF）的话，OCR 相关的几个包都可以不装，
应用会如实显示"扫描件识别不可用"，不会假装没找到日期。

装完之后跑一次自检，确认各项参数在这台机器上真的生效：

```bash
sudo -u labbench LAB_BENCH_DB=/var/lib/lab-bench/lab.db \
    /opt/lab-bench/.venv/bin/python server/manage.py checkenv
```

重点看两行：**口令算法**应该是 `argon2id`（不是 pbkdf2），
**内存上限生效**应该是「是」（Linux 上会是「是」；macOS 不强制 RLIMIT_AS，会显示「否」）。

## 3. 建第一个账号

**系统不带任何默认账号**，没建管理员之前所有接口返回 503。

```bash
cd /opt/lab-bench/server
sudo -u labbench LAB_BENCH_DB=/var/lib/lab-bench/lab.db \
    /opt/lab-bench/.venv/bin/python manage.py createadmin
```

口令是交互式输入的，不走命令行参数——参数会留在 shell history 和 `ps` 输出里。

其它命令：

```bash
python manage.py listusers               # 看账号
python manage.py passwd <用户名>          # 重置口令（会踢掉该账号所有会话）
python manage.py importjson backup.json  # 灌入旧的浏览器版备份
python manage.py purge                   # 清理过期会话
```

## 4. 迁移旧数据

在旧的浏览器版本里「数据」页导出 JSON，拷到服务器，然后：

```bash
sudo -u labbench LAB_BENCH_DB=/var/lib/lab-bench/lab.db \
    /opt/lab-bench/.venv/bin/python manage.py importjson /tmp/backup.json
```

缺字段的老备份可以直接用，导入时会自动补齐；单条不合法的记录会被跳过并计数，
不会让整份备份失败。

## 5. 起服务

```bash
sudo cp deploy/lab-bench.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lab-bench
sudo journalctl -u lab-bench -f
```

## 6. nginx 与证书

证书用阿里云免费 DV 证书或 Let's Encrypt 都行，放到 `/etc/nginx/ssl/`。

```bash
sudo cp deploy/nginx.conf /etc/nginx/conf.d/lab-bench.conf
sudo vim /etc/nginx/conf.d/lab-bench.conf   # 改域名和证书路径
```

在 `/etc/nginx/nginx.conf` 的 `http {}` 里加一行（登录限速用）：

```nginx
limit_req_zone $binary_remote_addr zone=login:10m rate=12r/m;
```

然后 `sudo nginx -t && sudo systemctl reload nginx`。

## 7. 备份

```bash
sudo cp deploy/backup.sh /opt/lab-bench/deploy/
sudo crontab -e
# 0 3 * * * /opt/lab-bench/deploy/backup.sh >> /var/log/lab-bench-backup.log 2>&1
```

脚本用 `sqlite3 .backup` 而不是 `cp`——WAL 模式下直接拷文件可能拿到不一致的快照。

**备份默认留在同一台 ECS 上，机器挂了就一起没了。** 脚本末尾有同步到 OSS 的示例，
建议加上，或者定期从「数据」页导出一份放到自己电脑。

## 上线前对一遍

- [ ] 安全组只开 80/443/22，5299 没有对外
- [ ] `LAB_BENCH_SECURE_COOKIE=1`（默认值；置 0 会让会话 Cookie 明文过网络）
- [ ] HTTPS 能访问，HTTP 自动跳转
- [ ] 用 `curl -I https://你的域名/` 确认有 `content-security-policy` 和 `strict-transport-security`
- [ ] `https://你的域名/uploads/任意文件名` 返回 404（合同原件不能被直接下载）
- [ ] 用学生账号登录，确认看不到横向课题、经费、合同、其他同学的数据
- [ ] `free -h` 能看到 2GB swap
- [ ] `manage.py checkenv` 里口令算法是 argon2id、内存上限生效为「是」
- [ ] 传一份真实的扫描版合同试一次，确认识别质量能接受
- [ ] 备份 cron 跑过一次，且备份文件能正常解压
- [ ] 给每个学生的初始口令是一次性的——他们首次登录会被强制改掉

## 排查

**登录报"系统尚未初始化"** —— 还没建管理员，跑 `manage.py createadmin`。

**学生说看不到某个页面** —— 这是设计如此。横向课题、经费、合同、档案扫描、账号管理
只对导师开放，且是**服务端**拦的，不是前端藏按钮。

**扫描件识别不出来** —— 先跑 `manage.py checkenv` 看引擎能不能加载。
首次调用要下模型，慢是正常的。

**扫描件识别报「内存不足」或「被系统终止」** —— 依次试：
确认 swap 配上了（`free -h`）；把 `LAB_BENCH_OCR_DPI` 降到 150；
把 `LAB_BENCH_OCR_MAX_PAGES` 调小、分批上传。
这些都在 systemd unit 里改，改完 `systemctl daemon-reload && systemctl restart lab-bench`。

**识别质量不满意** —— RapidOCR 和 PaddleOCR 用的是同一套模型，效果应该一致。
如果确实要换 PaddleOCR，取消 `requirements.txt` 里那两行注释装上，
再把 `LAB_BENCH_OCR_ENGINE=paddleocr`。**但它比 RapidOCR 重很多，2C2G 装不下**，
换之前先升配。

**登录变慢** —— argon2 是故意慢的（挡撞库）。如果慢到无法接受，
调低 `LAB_BENCH_ARGON2_MEMORY_MB`，但别低于 16。

**合同上传 413** —— nginx 的 `client_max_body_size` 和应用的 30MB 上限，两边都要看。
