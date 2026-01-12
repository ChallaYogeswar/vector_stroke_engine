# **1️⃣ FIX & LOCK — WHAT EXACTLY ARE WE BUILDING?**

### **🔒 Locked Product Definition**

You are building a:

**Data-Driven Vector Stroke Rendering Engine**  
that replays a portrait as if it is being *drawn live*, point-by-point, using pre-generated vector data.

### **🔒 What it IS**

* Deterministic (same input → same output)  
* Data-first (logic is minimal, data is massive)  
* Visual-first (code execution itself is part of the experience)  
* Runs in browser (Canvas-based MVP)

### **🔒 What it is NOT**

* ❌ AI image generation  
* ❌ Face recognition  
* ❌ Procedural art  
* ❌ SVG animation demo  
* ❌ CSS trick

This clarity matters because **every architecture decision depends on this**.

---

# **2️⃣ DESIGN ARCHITECTURE — ENGINE VIEW (NOT UI)**

Think like a game engine, not a website.

---

## **🧠 High-Level Architecture**

┌───────────────┐  
│ Raster Image  │  
└───────┬───────┘  
        ↓ (offline)  
┌──────────────────────────┐  
│ Vector Preprocessor Tool │  
│ (SVG → Points)           │  
└───────┬──────────────────┘  
        ↓ (JSON / Binary)  
┌──────────────────────────┐  
│ Stroke Data Store        │  
│ (Static asset)           │  
└───────┬──────────────────┘  
        ↓  
┌──────────────────────────┐  
│ Rendering Engine         │  
│ \- Timeline Controller   │  
│ \- Stroke Renderer       │  
│ \- Telemetry             │  
└───────┬──────────────────┘  
        ↓  
┌──────────────────────────┐  
│ Canvas Output            │  
│ \+ Console Telemetry      │  
└──────────────────────────┘

This separation is **non-negotiable**.

---

## **🧩 Core Engine Modules (LOCKED)**

### **1\. Data Loader**

* Loads stroke data  
* Validates format  
* Normalizes coordinates

### **2\. Timeline Controller**

* Controls playback speed  
* Handles pause / resume  
* Determines current point index

### **3\. Stroke Renderer**

* Draws incremental lines  
* Applies stroke style  
* Handles layer switching

### **4\. Telemetry System**

* Logs progress  
* Exposes counters  
* Optional UI overlay

This makes your engine **extensible**, not a one-off demo.

---

# **3️⃣ DATA FORMATS — THIS IS THE HEART**

If data is weak, the engine is useless.

---

## **🔹 Primary Data Format (MVP)**

### **stroke-data.json**

{  
  "meta": {  
    "width": 1024,  
    "height": 1024,  
    "totalPoints": 48291,  
    "layers": 4  
  },  
  "layers": \[  
    {  
      "name": "outline",  
      "stroke": "\#ffffff",  
      "points": \[  
        { "x": 112.3, "y": 210.6 },  
        { "x": 113.1, "y": 211.4 }  
      \]  
    },  
    {  
      "name": "eyes",  
      "stroke": "\#ff4444",  
      "points": \[  
        { "x": 402.1, "y": 389.2 }  
      \]  
    }  
  \]  
}

### **Why this format?**

* Human-readable (debuggable)  
* Layer-aware  
* Easy to optimize later (binary / typed arrays)

---

## **🔹 Coordinate Rules (LOCK THESE)**

All points are **normalized**  
0.0 → 1.0 (relative to canvas size)

*   
* No absolute pixels inside data  
* Scaling happens in renderer

This allows:

* Any screen size  
* Any resolution  
* Future WebGL port

---

# **4️⃣ STRONG, THOROUGH MVP (NO WEAK DEMO)**

This MVP is **portfolio-grade**.

---

## **✅ MVP FEATURES (MANDATORY)**

### **🎯 Rendering**

* Canvas full screen  
* Black background  
* White / red stroke  
* Incremental drawing  
* requestAnimationFrame loop

### **🎯 Telemetry (Visible & Console)**

* Current point  
* Total points  
* Current layer  
* Draw speed (points/sec)

Example console:

\[Renderer\] Layer: eyes  
\[Progress\] 18231 / 48291  
\[Speed\] 940 pts/sec

### **🎯 Controls**

* Play  
* Pause  
* Restart  
* Speed multiplier (0.5x / 1x / 2x)

### **🎯 Visual Polish**

* Slight jitter (optional)  
* Line cap \= round  
* Anti-aliased strokes

---

## **❌ Explicitly OUT of MVP**

* UI frameworks  
* AI  
* Video export  
* SVG animation fallback  
* Audio

We keep it **clean and strong**.

---

# **5️⃣ TECH STACK — WHAT TO INSTALL BEFORE STARTING**

### **🖥️ SYSTEM**

* Windows / Linux / macOS  
* 8GB RAM minimum (SVG parsing is heavy)

---

## **🔧 REQUIRED TOOLS (DOWNLOAD FIRST)**

### **1️⃣ Node.js (LTS)**

Used for:

* Local server  
* Data preprocessing scripts

👉 Install:

https://nodejs.org

---

### **2️⃣ VS Code**

Extensions:

* Live Server  
* SVG Viewer  
* JSON Formatter

---

### **3️⃣ Vector Tool**

Pick ONE:

* Vectorizer.ai (online)  
* Adobe Express SVG  
* Inkscape (offline, recommended)

---

### **4️⃣ Browser**

* Chrome (best Canvas perf)  
* DevTools required

---

## **🧪 OPTIONAL (LEVEL-UP TOOLS)**

* Inkscape CLI (SVG cleanup)  
* svgo (SVG optimization)  
* ffmpeg (future video export)

---

# **6️⃣ DEVELOPMENT ORDER (DO NOT SKIP)**

**This order prevents failure:**

1. Vectorize image → clean SVG  
2. Extract `<path d="">`  
3. Convert SVG → point array (offline script)  
4. Save as JSON  
5. Build canvas renderer  
6. Add telemetry  
7. Add controls  
8. Polish visuals

No UI before step 5\.

---

# **FINAL LOCK-IN SUMMARY**

You are building:

**A deterministic, data-driven vector replay engine**

You now have:

* ✅ Clear scope  
* ✅ Engine architecture  
* ✅ Data formats  
* ✅ Strong MVP definition  
* ✅ Exact tech stack

---

