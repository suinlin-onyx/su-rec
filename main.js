/*
FunASR Transcription Plugin - Client Mode
连接后台服务进行转写
*/

var import_obsidian = require("obsidian");
var import_net = require("net");

var FunASRTranscribe = class extends import_obsidian.Plugin {
    constructor() {
        super(...arguments);
        this.isRecording = false;
        this.client = null;
        this.currentText = "";
        this.lastText = "";
        this.ribbonIcon = null;
        this.currentFile = "";
        this.serverProcess = null;
    }

    async onload() {
        var self = this;

        this.ribbonIcon = this.addRibbonIcon("mic", "Transcription", () => {
            self.toggleRecording();
        });
        this.ribbonIcon.style.backgroundColor = "#ffd966";
        this.ribbonIcon.style.borderRadius = "50%";
        this.ribbonIcon.style.padding = "6px";

        this.statusBarItem = this.addStatusBarItem();
        this.statusBarItem.setText("Ready");

        // 连接服务器
        this.tryConnect();

        console.log("Plugin loaded");
    }

    onunload() {
        // 保存当前内容
        if (this.currentText) {
            this.updateNoteSync();
        }
        this.disconnect();
        console.log("Plugin unloaded");
    }

    // 尝试连接服务器
    tryConnect() {
        var self = this;

        this.statusBarItem.setText("Connecting...");

        // 关闭旧连接
        if (this.client) {
            try { this.client.destroy(); } catch(e) {}
            this.client = null;
        }

        this.client = new import_net.Socket();

        this.client.on("error", function(err) {
            console.log("Connection error:", err.message);
            self.statusBarItem.setText("Starting server...");
            self.ribbonIcon.style.backgroundColor = "#ffb3ba";
            self.startServer();
        });

        this.client.on("close", function() {
            console.log("Connection closed");
            self.isRecording = false;
            self.statusBarItem.setText("Disconnected");
            self.ribbonIcon.style.backgroundColor = "#ff6666";
        });

        this.client.on("data", function(data) {
            var text = data.toString("utf-8");
            self.handleServerData(text);
        });

        this.client.connect(9876, "127.0.0.1", function() {
            console.log("Connected to server");
            self.statusBarItem.setText("Ready");
            self.ribbonIcon.style.backgroundColor = "#ffd966";
            new import_obsidian.Notice("Server connected");
        });
    }

    // 启动服务器
    startServer() {
        var self = this;
        console.log("Starting server...");

        var spawn = require("child_process");
        var serverPath = "D:\\arvin\\obsidian_workpace\\voice-transcribe\\transcribe_server.py";

        // 先杀掉旧进程
        if (this.serverProcess) {
            try { this.serverProcess.kill(); } catch(e) {}
        }

        // 启动新进程
        this.serverProcess = spawn.spawn("py", ["-3.11", serverPath], {
            cwd: "D:\\arvin\\obsidian_workpace\\voice-transcribe",
            shell: true,
            detached: false,
            stdio: ["ignore", "pipe", "pipe"]
        });

        this.serverProcess.stdout.on("data", function(data) {
            console.log("Server:", data.toString().trim());
        });

        this.serverProcess.stderr.on("data", function(data) {
            console.log("Server err:", data.toString().trim());
        });

        this.serverProcess.on("close", function(code) {
            console.log("Server closed:", code);
            self.serverProcess = null;
        });

        // 等待服务器启动后连接
        setTimeout(function() {
            self.tryConnect();
        }, 5000);
    }

    // 处理服务器数据
    handleServerData(text) {
        if (!this.isRecording) return;

        // 过滤掉命令响应（如 OK: started, OK: stopped 等）
        if (/^OK:/.test(text.trim())) {
            return;
        }

        // 过滤掉系统消息
        if (/^(Recording|Transcription|Model|Server)/.test(text.trim())) {
            return;
        }

        text = text.replace(/\x1b\[[0-9;]*m/g, "");
        text = text.replace(/<\|[^|]*\|>/g, "");
        text = text.replace(/^.*100%.*$/gm, "");
        text = text.replace(/^.*\|.*$/gm, "");
        text = text.replace(/^.*Listening.*$/gm, "");

        var matches = text.match(/[一-龥a-zA-Z0-9.,!?;:，。！？；：""''（）【】《》\s]+/g);
        if (matches) {
            var extracted = matches.join("").trim();
            if (extracted && extracted.length > 0) {
                if (extracted !== this.lastText) {
                    this.currentText += extracted + " ";
                    this.lastText = extracted;

                    var preview = extracted.substring(0, 30);
                    if (extracted.length > 30) preview += "...";
                    this.statusBarItem.setText(preview);
                    this.ribbonIcon.style.backgroundColor = "#90EE90";

                    this.updateNote();
                }
            }
        }
    }

    toggleRecording() {
        if (this.isRecording) {
            this.stopRecording();
        } else {
            this.startRecording();
        }
    }

    async startRecording() {
        var self = this;

        if (!this.client || this.client.destroyed) {
            new import_obsidian.Notice("Not connected, trying...");
            this.tryConnect();
            return;
        }

        await this.ensureFileOpen();
        await this.insertNewSegment();

        this.isRecording = true;
        this.currentText = "";
        this.lastText = "";

        this.statusBarItem.setText("Recording...");
        this.ribbonIcon.style.backgroundColor = "#ffb3ba";

        new import_obsidian.Notice("Recording started");

        this.client.write("start\n");
    }

    stopRecording() {
        if (!this.isRecording) return;

        this.isRecording = false;
        this.statusBarItem.setText("Stopped");
        this.ribbonIcon.style.backgroundColor = "#ffd966";

        // 确保内容已保存
        if (this.currentText) {
            this.updateNote();
        }

        new import_obsidian.Notice("Recording stopped");

        if (this.client && !this.client.destroyed) {
            this.client.write("stop\n");
        }
    }

    async ensureFileOpen() {
        var now = new Date();
        var dateStr = now.toISOString().slice(0, 10);
        var dirPath = "00.raw/01.投资研究/音频转录";
        var filename = dirPath + "/转录_" + dateStr + ".md";

        var dir = this.app.vault.getAbstractFileByPath(dirPath);
        if (!dir) {
            await this.app.vault.createFolder(dirPath);
        }

        var file = this.app.vault.getAbstractFileByPath(filename);
        if (!file) {
            file = await this.app.vault.create(filename, `# 转录记录 (${dateStr})\n\n`);
        }

        this.currentFile = filename;

        var leaves = this.app.workspace.getLeavesOfType("markdown");
        var alreadyOpen = false;
        for (var i = 0; i < leaves.length; i++) {
            if (leaves[i].view && leaves[i].view.file && leaves[i].view.file.path === filename) {
                alreadyOpen = true;
                break;
            }
        }

        if (!alreadyOpen) {
            this.app.workspace.getLeaf(true).openFile(file);
        }
    }

    async insertNewSegment() {
        var now = new Date();
        var timeStr = now.toLocaleString("zh-CN", {
            year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", second: "2-digit"
        });

        // 确保文件存在
        await this.ensureFileOpen();

        // 直接读取文件并在末尾追加
        var file = this.app.vault.getAbstractFileByPath(this.currentFile);
        if (!file) return;

        var content = await this.app.vault.read(file);

        // 追加新片段
        var newSegment = "\n---\n### " + timeStr + "\n";
        await this.app.vault.modify(file, content + newSegment);

        // 同步编辑器
        var activeView = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
        if (activeView && activeView.file && activeView.file.path === this.currentFile) {
            var editor = activeView.editor;
            editor.setValue(content + newSegment);
        }
    }

    async updateNote() {
        if (this.currentText === "") return;

        var file = this.app.vault.getAbstractFileByPath(this.currentFile);
        if (!file) return;

        var content = await this.app.vault.read(file);

        var lastHeaderIdx = content.lastIndexOf("### ");
        if (lastHeaderIdx < 0) return;

        var afterHeader = content.indexOf("\n", lastHeaderIdx);
        if (afterHeader < 0) return;
        afterHeader++;

        var nextDivider = content.indexOf("\n---", afterHeader);

        var before = content.substring(0, afterHeader);
        var after = nextDivider > 0 ? content.substring(nextDivider) : "";

        var newContent = before + this.currentText + "\n" + after;

        await this.app.vault.modify(file, newContent);

        var activeView = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
        if (activeView && activeView.file && activeView.file.path === this.currentFile) {
            var editor = activeView.editor;
            editor.setValue(newContent);
            editor.setCursor({ line: editor.lineCount() - 1, ch: 0 });
        }
    }

    disconnect() {
        // 先保存当前内容
        if (this.currentText) {
            this.updateNoteSync();
        }

        if (this.client) {
            try { this.client.write("quit\n"); } catch(e) {}
            try { this.client.destroy(); } catch(e) {}
            this.client = null;
        }
        if (this.serverProcess) {
            try { this.serverProcess.kill(); } catch(e) {}
            this.serverProcess = null;
        }
    }

    // 同步保存（用于关闭时）
    updateNoteSync() {
        if (!this.currentText || !this.currentFile) return;

        // 使用同步方式读取和写入
        var fs = require("fs");
        var path = require("path");
        var vaultPath = this.app.vault.adapter.basePath;
        var filePath = path.join(vaultPath, this.currentFile);

        try {
            var content = fs.readFileSync(filePath, "utf-8");

            var lastHeaderIdx = content.lastIndexOf("### ");
            if (lastHeaderIdx >= 0) {
                var afterHeader = content.indexOf("\n", lastHeaderIdx);
                if (afterHeader >= 0) {
                    afterHeader++;
                    var nextDivider = content.indexOf("\n---", afterHeader);
                    var before = content.substring(0, afterHeader);
                    var after = nextDivider > 0 ? content.substring(nextDivider) : "";
                    var newContent = before + this.currentText + "\n" + after;
                    fs.writeFileSync(filePath, newContent, "utf-8");
                    console.log("Saved final content to file");
                }
            }
        } catch(e) {
            console.error("Failed to save:", e);
        }
    }
};

module.exports = FunASRTranscribe;
