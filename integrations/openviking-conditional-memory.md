### OpenViking 条件写入
本机容器需安装 `scripts/install-openviking-conditional.ps1` 提供的服务端适配。重建容器后须重新安装。安装器先检查源码是否匹配。版本读取返回同一次读取的可见原文和 SHA-256，替换与删除在 OpenViking 原有文件锁内检查审核时的版本。发生冲突后须重新读取和审核。未安装适配时，插件不会改用无条件写入。
