<div align="center">

  <img src="src-tauri/icons/128x128@2x.png" width="96" height="96" alt="Nexus Files 圖示" />

  # Nexus Files

  **極致輕巧、迅速且現代化的 Windows 11 桌面檔案總管。**  
  *以 Tauri 2、Vite 與 Rust 打造 — 掃除總管肥大積弊，回歸純粹的原生高效能。*

  <p align="center">
    <a href="README.md">English</a> •
    <a href="README.zh-TW.md"><b>繁體中文</b></a>
  </p>

  [![Tauri 2](https://img.shields.io/badge/Tauri-v2.0-24C8D8?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app/)
  [![Rust](https://img.shields.io/badge/Rust-1.75+-CE422B?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org/)
  [![Vite](https://img.shields.io/badge/Vite-v6.0-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev/)
  [![作業系統](https://img.shields.io/badge/Platform-Windows%2010%20%7C%2011-0078D4?style=flat-square&logo=windows&logoColor=white)](https://www.microsoft.com/windows)
  [![冷啟動速度](https://img.shields.io/badge/冷啟動-%3C%200.4s-success?style=flat-square)](#-架構與產品哲學)
  [![記憶體佔用](https://img.shields.io/badge/記憶體佔用-%3C%2060%20MB-blueviolet?style=flat-square)](#-架構與產品哲學)
  [![授權條款](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

  <br />

  [核心特點](#-核心亮點) •
  [架構與哲學](#-架構與產品哲學) •
  [快捷鍵速查](#-鍵盤快捷鍵速查) •
  [快速開始](#-快速開始) •
  [打包發行版本](#-建置發行安裝檔)

</div>

---

> **“把總管變慢的東西拿掉，把每天都在用的東西做快、做穩。”**  
> 這是 Nexus Files 的核心使命。移除惱人的背景外掛、預覽卡頓與龐大索引，保留每日操作的核心剛需，並將其做到極致靈敏。

---

## ⚡ 為什麼選擇 Nexus Files？

傳統 Windows 檔案總管最大的痛點不是功能不足，而是**架構過於肥大**：冷啟動耗時長、外掛處理程序不可預期崩潰、背景搜尋索引吃滿磁碟 I/O，遇到上萬檔案的大資料夾就頻繁卡死。

**Nexus Files** 遵循一項核心原則：**快，本身就是最強大的功能。** 每個功能都必須付得起效能帳單；只要模組處於關閉狀態，其 CPU、記憶體與磁碟消耗就嚴格為 0。

| 核心指標 | Nexus Files | Windows 原生檔案總管 |
|:---|:---:|:---:|
| **冷啟動就緒時間** | **< 0.4 秒**（瞬間呈現） | 約 1.5 秒 ～ 4.0 秒 |
| **常駐閒置記憶體** | **約 40 ～ 60 MB** | 150 ～ 450+ MB |
| **瀏覽 10,000+ 檔案資料夾** | **60 FPS 極致流暢**（虛擬化捲動） | 劇烈掉幀、白畫面甚至無回應 |
| **關閉後工作階段復原** | **即時無損還原分頁與完整瀏覽歷程** | 支援有限、經常丟失分頁 |
| **壓縮檔直接瀏覽** | **秒開虛擬檔案系統（`archive://`）** | 解壓延遲高、耗費額外暫存空間 |
| **誤刪安全復原** | **Ctrl+Z 一鍵從回收筒原路還原** | 復原觸發不穩定 |
| **以管理員身分執行** | **Win32 原生 UAC 提權機制** | 標準支援 |

---

## ✨ 核心亮點

### 🚀 極致效能與零臃腫架構
- **瞬間冷啟動（< 0.4s）**：無阻塞 IPC 設計，系統路徑採非同步平行載入，點開立即進入工作狀態。
- **萬級清單虛擬化（Virtualized List）**：透過 DOM 高效回收機制，面對 10,000+ 檔案的目錄依然維持 60 FPS 絲滑滾動。
- **Win32 工作集記憶體壓縮（Working Set Trimming）**：視窗模糊或閒置時自動呼叫系統 API 壓縮釋放無用記憶體，常駐記憶體遠低於 60 MB。
- **受控快取與視口載入**：縮圖在 Rust 端快速降採樣（128x128 JPEG ~3KB），前端僅針對進入螢幕可視區的項目觸發載入，絕不浪費 CPU 偷算不可見項目。

### 🪟 Windows 11 原生 Fluent Mica 視覺體驗
- **經典雙排功能區工具列（Ribbon Toolbar）**：剪下、複製、貼上、復原、重新命名、刪除、排序、檢視一應俱全。
- **Fluent Mica 毛玻璃右鍵選單**：全自製 Windows 11 風格右鍵選單，具備頂部快捷指令列、平滑淡入動畫與精準快捷鍵提示。
- **Windows 11 原生檔案屬性對話框**：完整呈現檔案資訊、背景即時計算資料夾容量與檔案數量、預設開啟應用程式切換，以及 Win32 屬性（唯讀／隱藏）切換。
- **告別網頁原生彈窗**：全面消除 `alert()`、`confirm()` 與 `tauri.localhost 說`，全由精美 Fluent Toast 吐司通知與對話框取代。

### 🛡️ Windows 原生 UAC 提權（以系統管理員身分執行）
- **Win32 原生提權引擎**：以 `ShellExecuteW` 與 `runas` 動詞驅動，零黑窗閃爍，直接喚起 Windows 正統 UAC 提權確認視窗。
- **執行檔與腳本提權**：對 `.exe`、`.bat`、`.cmd`、`.msi`、`.ps1`、`.vbs`、`.reg` 右鍵即可「以系統管理員身分執行」。
- **受保護設定檔快速編輯**：對系統 `hosts`、`.ini`、`.log`、`.json` 設定檔點擊管理員開啟，自動叫起提權的記事本進行編輯儲存。
- **管理員終端機**：空白處、資料夾或工具列均可一鍵「以系統管理員身分開啟終端機」（優先叫起 Windows Terminal，無縫切換當前路徑）。

### 📑 現代化分頁與雙窗格（Dual-Pane）
- **強大分頁操作**：支援拖曳重排、分頁固定（Pin）、滑鼠中鍵關閉，以及 `Ctrl+Shift+T` 復原剛關閉的分頁。
- **工作階段自動復原**：重新開啟應用程式時，自動還原上次開啟的所有分頁、當前焦點與個別瀏覽歷史。
- **雙窗格模式（`F10`）**：按下 `F10` 立即進入雙面板並排瀏覽，左右拖放、對比複製更高效，關閉時零效能負擔。

### 📂 Windows 原生風格「常用與近期資料夾」
- **Frecency 智慧演算法**：結合停留時間與存取頻率（單次需停留 >= 4 秒才計入，路過穿過的資料夾絕不干擾清單）。
- **強大的選單控制**：隨時右鍵將近期資料夾釘選至快速存取、精準從近期清單移除，或一鍵清空歷程記錄。

### 🏷️ 彈性動態檔案標籤系統
- **自訂標籤管理**：自由新增、編輯標籤名稱，並配有專屬色票指示燈號。
- **虛擬路徑導航（`nexus://tag/<tag-id>`）**：將跨磁碟、跨目錄的同標籤檔案彙整於同一虛擬視角中檢視。
- **拖曳上標籤**：直接將檔案拖移至側邊欄的標籤項目，立即完成標籤綁定。

### 📦 虛擬壓縮檔檔案系統
- **免解壓直接瀏覽**：支援 `.zip`、`.tar.gz`、`.tar.bz2` 等格式，使用 `archive://` 虛擬協定像瀏覽一般目錄般輕鬆。
- **即時內容預覽**：壓縮檔內的圖片、文字可直接點擊查看，免去繁瑣解壓流程。
- **向外拖放解壓**：直接將壓縮檔內部的檔案拖曳至桌面或其他外部資料夾完成即時解壓縮。

### ↩️ 全域安全復原子系統（`Ctrl+Z`）
- **誤刪秒還原**：按下 `Ctrl+Z` 即可自動從 Windows 資源回收筒中撈回檔案，精準放回原始刪除路徑。
- **完整操作歷程**：支援撤銷更名、復原檔案移動，以及撤銷新增資料夾。

---

## ⌨️ 鍵盤快捷鍵速查

Nexus Files 專為鍵盤愛好者設計，操作直覺順暢：

### 導覽與檢視
| 快捷鍵 | 功能說明 |
|:---|:---|
| `Alt + ←` / `Alt + →` | 在分頁歷史中後退／前進 |
| `Alt + ↑` / `Backspace` | 回到上一層資料夾 |
| `F5` / `Ctrl + R` | 重新整理目前目錄 |
| `Ctrl + F` | 開啟目錄即時篩選列（純記憶體過濾，零磁碟 I/O） |
| `Ctrl + K` | 開啟命令面板（搜尋系統指令與當前資料夾檔案） |
| `Ctrl + H` | 切換顯示／隱藏系統隱藏檔案 |
| `F10` | 切換雙窗格並排檢視模式 |

### 檔案操作
| 快捷鍵 | 功能說明 |
|:---|:---|
| `Enter` | 開啟檔案／進入資料夾 |
| `F2` | 重新命名檔案 |
| `Ctrl + C` / `Ctrl + X` | 複製／剪下所選檔案 |
| `Ctrl + V` | 貼上剪貼簿內容 |
| `Ctrl + Z` | **復原最近一次操作**（還原回收筒檔案、撤銷更名／移動） |
| `Delete` | 將選取項目移至資源回收筒 |
| `Alt + Enter` | 開啟 Windows 11 原生屬性視窗 |
| `Ctrl + Shift + N` | 新增資料夾 |

### 分頁管理
| 快捷鍵 | 功能說明 |
|:---|:---|
| `Ctrl + T` | 新增分頁 |
| `Ctrl + W` | 關閉當前分頁 |
| `Ctrl + Shift + T` | 復原剛關閉的分頁 |
| `Ctrl + 1` ～ `Ctrl + 9` | 直接切換至第 1 到第 9 個分頁 |

---

## 🏛️ 架構與產品哲學

```
┌─────────────────────────────────────────────────────────┐
│                 Nexus Files 架構設計                     │
├───────────────────────────┬─────────────────────────────┤
│         前端 (UI)         │         後端 (Rust)         │
│                           │                             │
│   原生 Vanilla JS (無VDOM) │      Tauri 2 核心 API       │
│   高效率 DOM 虛擬清單     │      tokio 執行緒池 (Blocking) │
│   全域視窗事件捕獲         │      trash-rs (資源回收筒控制) │
│   Mica & Acrylic 毛玻璃   │      Win32 ShellExecuteW 提權  │
│   毫秒級客戶端搜尋過濾     │      Archive 虛擬檔案系統      │
└───────────────────────────┴─────────────────────────────┘
```

Nexus Files 嚴格落實 **[PHILOSOPHY.md](./PHILOSOPHY.md)** 中定義的五大效能鐵律：

1. **冷啟動速度是一項核心功能** — 首幀有效繪製必須在 400ms 內完成。
2. **預設不做耗資源的繁重工作** — 不在啟動時預先掃描全磁碟，不預先計算資料夾大小。
3. **功能必須能夠隨關隨卸** — 預覽面板、雙窗格與目錄監聽器在關閉時開銷嚴格為 0。
4. **只為使用者當下看見的東西付費** — 圖示、縮圖與 DOM 節點僅在進入可視區域時生成。
5. **風格統一的 UI 線條圖示** — 採用向量 SVG 線條圖示，徹底避免呼叫 Windows Shell 提取圖示導致的 COM 執行緒阻塞與延遲。

---

## 🚀 快速開始

### 前置環境需求
- **作業系統**：Windows 10（組建 19041+）或 Windows 11
- **Node.js**：`18.0` 以上版本
- **Rust 工具鏈**：`stable` 版本（可至 [rustup.rs](https://rustup.rs/) 安裝）
- **Visual Studio C++ Build Tools**（Windows 編譯 Rust 必備環境）

### 1. 複製專案庫
```bash
git clone https://github.com/RainWu0123/Nexus-Flie.git
cd Nexus-Flie
```

### 2. 安裝相依套件
```bash
npm install
```

### 3. 啟動開發伺服器（熱重載）
```bash
npm run tauri dev
```

---

## 📦 建置發行安裝檔

若需產出最佳化且經過 Symbol 剝除的獨立可執行檔（`.exe`）或安裝檔（`.msi`）：

```bash
npm run tauri build
```

編譯完成的產物將存放於：
- 獨立綠色執行檔：`src-tauri/target/release/nexus-files.exe`
- MSI 安裝檔：`src-tauri/target/release/bundle/msi/Nexus Files_0.1.0_x64_en-US.msi`
- NSIS 安裝導精：`src-tauri/target/release/bundle/nsis/Nexus Files_0.1.0_x64-setup.exe`

---

## 🌐 多語系支援

Nexus Files 內建完整的在地化多國語言支援：
- **繁體中文**（zh-TW）
- **English**（en）
- **简体中文**（zh-CN）
- **日本語**（ja）

系統將依據您的 Windows 語系自動偵測適配，亦可於設定中手動切換。

---

## 📄 授權條款

本專案遵循 **[MIT 授權條款](LICENSE)** 發布。

<div align="center">
  <sub>專為更迅速、更順手的桌面檔案管理體驗而生。如果您喜歡 Nexus Files，歡迎給予一顆 ⭐️ 鼓勵！</sub>
</div>
