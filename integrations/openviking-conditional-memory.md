### OpenViking 条件写入

一键启动会调用 `scripts/install-openviking-conditional.ps1`。默认检查 `dsh-openviking`，通过 Docker 的端口映射找到本机服务。脚本核对五个服务端源文件和运行中的 OpenAPI 接口。已经就绪的容器保持运行；同名容器重建后，如果源码匹配已验证的原版，脚本会重新安装、重启并验证。未知版本或只应用了部分补丁时，脚本停止修改并报告原因。

岑舒生活设置页显示最近一次启动检查的时间与结果，页面打开时每 15 秒刷新。检查记录位于 DSH 数据目录下的 `cen-shu-life/openviking-adapter.json`。遇到升级不兼容，须针对新源码重新验证服务端锁和版本检查，再更新补丁及 `openviking-conditional-sources.json`；更新后重新运行一键启动。

服务端返回同一次读取的可见原文和 SHA-256，替换与删除在文件锁内核对审核时的版本。发生冲突后需重新读取并审核。未安装适配时，插件会拒绝无版本保护的写入。

测试其他容器时，传入 `-Container` 和独立的 `-StateDirectory`，以免覆盖正式启动记录。
