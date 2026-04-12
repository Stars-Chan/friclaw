# GitHub 手动下载安装 Bun 完整方案

如果无法使用官方安装脚本，或希望避免依赖 Homebrew / npm，可以直接从 GitHub Releases 手动下载安装 Bun。

## 1. 下载文件

访问 GitHub Releases 页面：

https://github.com/oven-sh/bun/releases

根据你的 Mac 架构选择对应压缩包：

- Apple Silicon（M1 / M2 / M3 / M4）：`bun-darwin-aarch64.zip`
- Intel Mac：`bun-darwin-x64.zip`

## 2. 解压文件

以 Apple Silicon 为例：

```bash
cd ~/Downloads
unzip bun-darwin-aarch64.zip
```

如果你下载的是 Intel 版本，请将文件名替换为 `bun-darwin-x64.zip`。

## 3. 创建用户 bin 目录

```bash
mkdir -p ~/.local/bin
```

## 4. 移动二进制文件

以 Apple Silicon 为例：

```bash
mv bun-darwin-aarch64/bun ~/.local/bin/bun
```

如果是 Intel Mac，请改为对应目录：

```bash
mv bun-darwin-x64/bun ~/.local/bin/bun
```

## 5. 配置 PATH

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

## 6. 验证安装

```bash
bun --version
```

## 这种方式的优势

- 不需要 VPN
- 不依赖 Homebrew 或 npm
- 安装快速
- 适合国内网络环境

## 清理（可选）

以 Apple Silicon 为例：

```bash
rm ~/Downloads/bun-darwin-aarch64.zip
rm -rf ~/Downloads/bun-darwin-aarch64
```

如果你下载的是 Intel 版本，请将文件名替换为对应的 `bun-darwin-x64`。