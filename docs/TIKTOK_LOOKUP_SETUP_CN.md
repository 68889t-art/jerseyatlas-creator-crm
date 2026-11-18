# JerseyAtlas TikTok 公开资料自动识别（免费部署）

本功能为 CRM 增加 TikTok 公开主页与作品链接识别。识别结果只回填表单；管理员检查后仍需手动点击“保存达人”或“保存视频记录”。不会自动覆盖现有达人，也不会自动写入数据库。

## 当前实现

- Supabase Edge Function：`tiktok-lookup`
- 主页识别：账号名称、@用户名、公开页面提供的粉丝数、页面明确提供的地区代码（映射为英国/法国/德国/美国/巴西）
- 作品识别：播放量、点赞、评论、分享、发布时间、发布者用户名
- 前端：达人表单“自动识别”；视频表单“获取视频数据”
- 访问控制：需要有效 CRM 登录会话；仅已激活管理员可调用
- 安全：仅允许 TikTok 域名，拒绝跳转到其他域名；不把 Cookie、密码或 Service Role Key 放入浏览器代码

## 免费部署前提

Supabase Free 当前包含 Edge Function 每月 500,000 次调用配额，但存在 CPU、内存、执行时长等限制。TikTok 可能返回验证码、登录墙、403/429 或更改页面结构，因此不能保证所有账号和视频每次都能识别。免费额度不等于对 TikTok 数据的永久可用保证。

## 一次性部署步骤

### 1. 创建 Supabase Access Token

1. 打开 https://supabase.com/dashboard/account/tokens
2. 创建一个 Personal Access Token。
3. 复制 token。不要发到聊天、不要提交到 GitHub 代码文件。

### 2. 将 Token 添加到 GitHub Actions Secret

1. 打开 https://github.com/68889t-art/jerseyatlas-creator-crm/settings/secrets/actions
2. 点击 New repository secret。
3. Name 填写：`SUPABASE_ACCESS_TOKEN`
4. Secret 粘贴刚刚创建的 Supabase Personal Access Token。
5. 保存。

### 3. 运行部署工作流

1. 打开 https://github.com/68889t-art/jerseyatlas-creator-crm/actions
2. 选择 “Deploy TikTok lookup Edge Function”。
3. 点击 Run workflow，再点击绿色 Run workflow。
4. 等待部署成功（绿色勾）。

该工作流只部署 Edge Function，不修改数据库表，也不会导入、删除或更新任何达人历史记录。

### 4. 刷新 CRM 测试

打开 https://68889t-art.github.io/jerseyatlas-creator-crm/ ，按 Ctrl+F5。

- 新增达人：粘贴 TikTok 主页链接，点“自动识别”。
- 视频统计：粘贴 TikTok 作品链接，点“获取视频数据”。
- 核对自动填入内容后，手动保存。

## 当前明确限制

1. 地区只在 TikTok 页面公开返回地区字段时识别；无法读取真实 IP 或通过 IP 推断达人所在地。
2. TikTok 非官方页面数据结构可能变化；若页面没有嵌入公开状态数据，会显示失败原因。
3. 短链接可尝试跟随跳转；若跳转触发登录、验证码或跳转至非 TikTok 域名，会安全停止。
4. 此版本不下载视频、不访问私密账号、不绕过验证码或登录保护。
5. 免费 Edge Function 有执行时长和 CPU 限制；若 TikTok 页面响应慢，可能超时。
6. 自动采集失败不会清空表单，不会覆盖现有记录；可以继续手动录入。

## 保留历史数据

本次修改只增加前端识别按钮和一个 Edge Function，不执行 SQL migration，不触碰 creators、creator_collaborations、creator_videos、creator_reward_tiers、outreach_logs 中的现有数据。
