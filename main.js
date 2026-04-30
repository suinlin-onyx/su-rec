/*
FunASR Transcription Plugin - State Machine v3
*/

var import_obsidian = require("obsidian");
var import_net = require("net");

var FunASRTranscribe = class extends import_obsidian.Plugin {
    constructor() {
        super(...arguments);

        // state: offline | connecting | recording | stopped
        this.state = "offline";
        this.isRecording = false;

        this.client = null;
        this.ribbonIcon = null;
        this.statusBarItem = null;
        this.serverProcess = null;
        this.currentFile = "";
        this.currentText = "";

        this._colors = {
            offline: "#ff4444",      // red
            connecting: "#4488ff",    // blue
            recording: "#44ff44",     // green
            stopped: "#ff8800"        // orange
        };

        this._labels = {
            offline: "Click to connect",
            connecting: "Connecting...",
            recording: "Click to stop",
            stopped: "Click to resume"
        };

        this._transitions = {
            offline: ["connecting"],
            connecting: ["recording", "stopped"],
            recording: ["stopped"],
            stopped: ["recording"]
        };

        this._isIntentionalClose = false;
        this._isStartingServer = false;
        this._retryTimer = null;
    }

    setState(newState) {
        var from = this.state;

        // allow self-transition
        if (from === newState) {
            return true;
        }

        var allowed = this._transitions[from];

        if (!allowed || !allowed.includes(newState)) {
            console.log("[State] " + from + " -> " + newState + " (invalid)");
            return false;
        }

        this.state = newState;
        this.ribbonIcon.style.backgroundColor = this._colors[newState];
        this.ribbonIcon.setAttribute("aria-label", this._labels[newState]);

        console.log("[State] " + from + " -> " + newState);
        return true;
    }

    async onload() {
        var self = this;

        this.ribbonIcon = this.addRibbonIcon("mic", "Transcription", () => {
            self.onClick();
        });
        this.ribbonIcon.style.borderRadius = "50%";
        this.ribbonIcon.style.padding = "6px";

        this.statusBarItem = this.addStatusBarItem();
        this.setState("offline");

        console.log("Plugin loaded");
    }

    onunload() {
        if (this.currentText) {
            this._saveSync();
        }
        this._cleanup();
    }

    onClick() {
        switch (this.state) {
            case "offline":
                this._tryConnect();
                break;

            case "connecting":
                // do nothing, wait
                break;

            case "recording":
                this._stopRecording();
                break;

            case "stopped":
                this._resumeRecording();
                break;
        }
    }

    _tryConnect() {
        var self = this;

        if (this.state !== "offline") {
            return;
        }

        this.setState("connecting");
        this.statusBarItem.setText("Connecting...");

        if (this.client) {
            try { this.client.destroy(); } catch(e) {}
            this.client = null;
        }

        this.client = new import_net.Socket();

        this.client.on("error", (err) => {
            console.log("[TCP] Error:", err.message);
            self.statusBarItem.setText("Connection failed, starting server...");

            // go back to offline so user can click again
            self._forceOffline();
            self._scheduleRetry();
        });

        this.client.on("close", () => {
            console.log("[TCP] Closed");

            // connection lost: force offline (bypass state machine)
            if (!self._isIntentionalClose && self.state !== "offline") {
                self._forceOffline();
            }
            self._isIntentionalClose = false;
        });

        this.client.on("data", (data) => {
            self._handleData(data.toString("utf-8"));
        });

        this.client.connect(9876, "127.0.0.1", () => {
            console.log("[TCP] Connected");
            new import_obsidian.Notice("Connected to server");
            self._isStartingServer = false;  // reset flag

            // connected -> start recording
            self.setState("recording");
            self._startRecording();
        });
    }

    _startServer() {
        var self = this;

        // prevent multiple server starts
        if (this._isStartingServer) {
            console.log("[Server] Already starting...");
            return;
        }
        this._isStartingServer = true;

        console.log("[Server] Starting...");

        this.statusBarItem.setText("Starting server...");

        var spawn = require("child_process");
        var serverPath = "D:\\arvin\\obsidian_workpace\\voice-transcribe\\transcribe_server_v3.py";

        if (this.serverProcess) {
            try { this.serverProcess.kill(); } catch(e) {}
        }

        this.serverProcess = spawn.spawn("cmd", ["/c", "start", "/B", "py", "-3.11", serverPath], {
            cwd: "D:\\arvin\\obsidian_workpace\\voice-transcribe",
            shell: false,
            detached: false
        });

        this.serverProcess.on("close", (code) => {
            console.log("[Server] Closed:", code);
            self.serverProcess = null;
        });
    }

    _scheduleRetry() {
        var self = this;

        // if server not running, start it first
        if (!this.serverProcess && !this._isStartingServer) {
            this._startServer();
        }

        // if already scheduled, don't reschedule
        if (this._retryTimer) {
            console.log("[Retry] Already scheduled");
            return;
        }

        this.statusBarItem.setText("Waiting for server (45s)...");
        this._retryTimer = setTimeout(() => {
            this._retryTimer = null;
            this._isStartingServer = false;  // reset for next retry
            this._tryConnect();
        }, 45000);
    }

    _startRecording() {
        if (!this.client || this.client.destroyed) {
            new import_obsidian.Notice("Connection lost");
            this.setState("offline");
            return;
        }

        this.isRecording = true;
        this.currentText = "";
        this.statusBarItem.setText("Recording...");

        this._ensureFile();
        this._insertSegment();

        new import_obsidian.Notice("Recording started");
        this.client.write("start\n");
    }

    _stopRecording() {
        if (!this.isRecording) return;

        this.isRecording = false;
        this.statusBarItem.setText("Stopped");

        if (this.currentText) {
            this._updateNote();
        }

        if (this.client && !this.client.destroyed) {
            this.client.write("stop\n");
        }

        new import_obsidian.Notice("Stopped");

        // go to stopped state (keep connection)
        if (this.state === "recording") {
            this.setState("stopped");
        }
    }

    _resumeRecording() {
        if (this.state !== "stopped") return;

        if (!this.client || this.client.destroyed) {
            new import_obsidian.Notice("Connection lost, reconnecting...");
            this._tryConnect();
            return;
        }

        this.setState("recording");
        this._startRecording();
    }

    _forceOffline() {
        this.state = "offline";
        this.isRecording = false;
        this.ribbonIcon.style.backgroundColor = this._colors.offline;
        this.ribbonIcon.setAttribute("aria-label", this._labels.offline);
        this.statusBarItem.setText("Click to connect");
        console.log("[State] -> offline (forced)");
    }

    _cleanup() {
        this._isIntentionalClose = true;
        this._isStartingServer = false;
        this.isRecording = false;

        if (this._retryTimer) {
            clearTimeout(this._retryTimer);
            this._retryTimer = null;
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

    _handleData(text) {
        if (!this.isRecording) return;
        if (/^OK/.test(text.trim())) return;
        if (/^(Recording|Transcription|Model|Server|Loading)/.test(text.trim())) return;

        text = text.replace(/\x1b\[[0-9;]*m/g, "");
        text = text.replace(/<\|[^|]*\|>/g, "");
        text = text.replace(/^.*100%.*$/gm, "");
        text = text.replace(/^.*\|.*$/gm, "");

        var matches = text.match(/[一-鿿-a-zA-Z0-9.,!?;:，。！？；：""''（）【】《》\s\n]+/g);
        if (!matches) return;

        var extracted = matches.join("");
        if (!extracted || extracted.length === 0) return;

        extracted = extracted.replace(/<br\s*>/gi, "\n");

        this.currentText += extracted;
        var preview = extracted.replace(/\n/g, "").slice(-20) || "...";
        this.statusBarItem.setText(preview);
        this._updateNote();
    }

    _ensureFile() {
        var now = new Date();
        var dateStr = now.toISOString().slice(0, 10);
        var dirPath = "00.raw/01.投资研究/音频转录";
        var filename = dirPath + "/转录_" + dateStr + ".md";

        var dir = this.app.vault.getAbstractFileByPath(dirPath);
        if (!dir) {
            this.app.vault.createFolder(dirPath);
        }

        var file = this.app.vault.getAbstractFileByPath(filename);
        if (!file) {
            this.app.vault.create(filename, "# Transcription (" + dateStr + ")\n\n");
        }

        this.currentFile = filename;
    }

    _insertSegment() {
        var self = this;
        var now = new Date();
        var timeStr = now.toLocaleString("zh-CN", {
            year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", second: "2-digit"
        });

        this._ensureFile();
        var file = this.app.vault.getAbstractFileByPath(this.currentFile);
        if (!file) return;

        this.app.vault.read(file).then(function(content) {
            var newSegment = "\n---\n### " + timeStr + "\n";
            self.app.vault.modify(file, content + newSegment);
        });
    }

    _updateNote() {
        var self = this;
        if (!this.currentText || !this.currentFile) return;

        var file = this.app.vault.getAbstractFileByPath(this.currentFile);
        if (!file) return;

        this.app.vault.read(file).then(function(content) {
            var lastHeaderIdx = content.lastIndexOf("### ");
            if (lastHeaderIdx < 0) return;

            var afterHeader = content.indexOf("\n", lastHeaderIdx);
            if (afterHeader < 0) return;
            afterHeader++;

            var nextDivider = content.indexOf("\n---", afterHeader);
            var before = content.substring(0, afterHeader);
            var after = nextDivider > 0 ? content.substring(nextDivider) : "";

            var newContent = before + self.currentText + "\n" + after;

            self.app.vault.modify(file, newContent);

            var activeView = self.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
            if (activeView && activeView.file && activeView.file.path === self.currentFile) {
                activeView.editor.setValue(newContent);
                activeView.editor.setCursor({ line: activeView.editor.lineCount() - 1, ch: 0 });
            }
        });
    }

    _saveSync() {
        if (!this.currentText || !this.currentFile) return;

        var fs = require("fs");
        var path = require("path");
        var filePath = path.join(this.app.vault.adapter.basePath, this.currentFile);

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
                }
            }
        } catch(e) {
            console.error("[File] Save failed:", e);
        }
    }
};

module.exports = FunASRTranscribe;
