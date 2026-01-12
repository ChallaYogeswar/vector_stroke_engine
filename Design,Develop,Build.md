Alright. From this point onward, I’ll treat you like a **solo engineer executing a locked blueprint**.  
What follows is **everything** you need to define, design, and build the system — end-to-end — with **no hand-holding, no filler, no “tutorial tone.”**

You asked to be thrown everything.  
This is the **implementation-grade specification**.

---

# **PHASE 2 & 3 — DEFINE • DESIGN • BUILD**

## **Data-Driven Vector Stroke Rendering Engine**

---

## **I. DEFINING (NON-NEGOTIABLE CONTRACTS)**

These are **rules**. If you violate them, the engine becomes fragile.

---

### **1️⃣ System Goal (Formal Definition)**

Given a static dataset of vector stroke points, the engine must deterministically replay the drawing over time with precise control over speed, order, and visual style.

---

### **2️⃣ Invariants (Must Always Be True)**

* Rendering logic never modifies stroke data  
* Stroke data is immutable once loaded  
* Time is the only changing variable  
* Renderer never “decides” what to draw — it only **replays**  
* No SVG rendering at runtime (SVG is preprocessing only)

---

### **3️⃣ Coordinate Space Contract**

* All coordinates are normalized  
* Range: `[0.0 – 1.0]`  
* Origin: top-left  
* Scaling happens at render time only

This guarantees:

* Resolution independence  
* Canvas resize safety  
* WebGL portability

---

## **II. DATA DESIGN (MOST IMPORTANT PART)**

This engine **lives or dies** by its data.

---

### **1️⃣ Canonical Stroke Data Format**

**stroke-data.json**

{  
  "meta": {  
    "source": "portrait-name",  
    "canvasAspect": 1.0,  
    "totalPoints": 48732,  
    "layers": 5,  
    "version": "1.0"  
  },  
  "layers": \[  
    {  
      "id": 0,  
      "name": "outline",  
      "style": {  
        "color": "\#ffffff",  
        "width": 1.4,  
        "cap": "round"  
      },  
      "points": \[  
        \[0.2341, 0.1822\],  
        \[0.2350, 0.1831\]  
      \]  
    }  
  \]  
}

---

### **2️⃣ Why Points Are Stored as Arrays, Not Objects**

\[0.2341, 0.1822\]

Instead of:

{ "x": 0.2341, "y": 0.1822 }

Reasons:

* Smaller memory footprint  
* Faster iteration  
* Easier binary conversion later  
* GPU-friendly

---

### **3️⃣ Layer Philosophy**

Each layer represents **intent**, not geometry.

Examples:

* outline  
* eyes  
* hair  
* beard  
* shadows

Layer order \= draw order  
Layer separation \= cinematic realism

---

## **III. SVG → POINTS (PREPROCESSING PIPELINE)**

This happens **offline**.  
Never in the browser.

---

### **1️⃣ SVG Hygiene Rules (Inkscape)**

Before extraction:

* Convert strokes to paths  
* Flatten transforms  
* Remove fills  
* Break compound paths  
* One visual concept \= one layer

Inkscape actions:

* Object → Ungroup  
* Path → Stroke to Path  
* Path → Flatten Beziers

---

### **2️⃣ Path Sampling Strategy (Critical)**

SVG paths are curves. You must **sample them**.

Sampling rules:

* Linear segments → uniform spacing  
* Bezier curves → adaptive sampling  
* More curvature \= more points  
* Flat segments \= fewer points

Target:

* 30k–60k total points for portrait  
* Below 20k looks robotic  
* Above 80k wastes time

---

### **3️⃣ SVG Parsing Algorithm (Conceptual)**

Pseudocode (design-level):

for each layer in svg:  
  for each path in layer:  
    decompose path commands  
    for each segment:  
      if line:  
        sample uniformly  
      if curve:  
        subdivide until error \< threshold  
      append points  
normalize all points  
export JSON

This is **deterministic geometry processing**, not graphics.

---

## **IV. ENGINE DESIGN (RUNTIME ARCHITECTURE)**

This is the core system.

---

### **1️⃣ Runtime Modules (Final)**

/engine  
  ├── DataLoader  
  ├── Timeline  
  ├── Renderer  
  ├── Telemetry  
  └── Controller

Each module has **one responsibility**.

---

### **2️⃣ Module Responsibilities**

#### **DataLoader**

* Fetch JSON  
* Validate schema  
* Precompute absolute coordinates

#### **Timeline**

* Current index  
* Speed multiplier  
* Play / pause / reset

#### **Renderer**

* Canvas setup  
* Stroke state  
* Incremental drawing

#### **Telemetry**

* Counters  
* Speed metrics  
* Console output

#### **Controller**

* User input  
* Wiring modules together

---

## **V. RENDERING ENGINE (THE CORE LOOP)**

### **The Only Loop That Matters**

Conceptual flow:

on frame:  
  determine points to draw this frame  
  for each point:  
    draw line segment  
    update counters  
  update telemetry  
  request next frame

No branching logic.  
No decision-making.  
Only progression.

---

### **Frame Budget Strategy**

* Do NOT draw 1 point per frame  
* Draw N points per frame  
* N \= speed × deltaTime

This avoids:

* Frame drops  
* Inconsistent animation  
* Browser throttling

---

## **VI. VISUAL RENDERING RULES**

### **Canvas Configuration**

* Fullscreen  
* DPR-aware scaling  
* Clear once at start only

### **Stroke Style Rules**

* `lineCap = round`  
* `lineJoin = round`  
* No shadows (performance)  
* No alpha blending initially

---

### **Organic Realism (Optional but Powerful)**

Add micro-noise:

x \+= random(-ε, ε)  
y \+= random(-ε, ε)

ε ≤ 0.001 (normalized)

This removes mechanical perfection.

---

## **VII. TELEMETRY SYSTEM (ENGINEERING AESTHETIC)**

Telemetry is not debugging.  
It is **part of the performance**.

---

### **Required Metrics**

* Current layer name  
* Current point index  
* Total points  
* Points per second  
* Playback speed

---

### **Console Output Style**

\[ENGINE\] Layer: hair  
\[DRAW\] 18231 / 48732  
\[SPEED\] 912 pts/sec

This reinforces the “code is drawing” illusion.

---

## **VIII. PROJECT STRUCTURE (FINAL)**

/project  
 ├── index.html  
 ├── style.css  
 ├── main.js  
 ├── /engine  
 │    ├── DataLoader.js  
 │    ├── Timeline.js  
 │    ├── Renderer.js  
 │    ├── Telemetry.js  
 │    └── Controller.js  
 ├── /data  
 │    └── stroke-data.json  
 └── /tools  
      └── svg-to-points.js

Clean. Intentional. Scalable.

---

## **IX. MVP COMPLETION CHECKLIST**

Your MVP is complete when:

* Portrait draws fully without stutter  
* Speed control works  
* Pause/resume works  
* Console telemetry is live  
* No SVG is used at runtime  
* Data can be swapped without code changes

If **any** of these fail → MVP incomplete.

---

## **X. WHAT YOU SHOULD BUILD FIRST (ORDER MATTERS)**

1. SVG cleanup in Inkscape  
2. SVG → point extraction script  
3. Static JSON validation  
4. Canvas renderer (no animation)  
5. Timeline \+ animation  
6. Telemetry  
7. Visual polish

Do **not** jump steps.

---

## **FINAL STATEMENT**

You now have:

* A locked system definition  
* A real data format  
* A deterministic rendering engine design  
* A preprocessing pipeline  
* A portfolio-grade MVP target

This is **not a demo**.  
This is a **foundational rendering system**.

