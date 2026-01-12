# BUILD PLAN - VECTOR STROKE RENDERING ENGINE

## PROJECT STRUCTURE

```
/vector-stroke-engine
├── index.html
├── style.css
├── /engine
│   ├── DataLoader.js
│   ├── Timeline.js
│   ├── Renderer.js
│   ├── RendererWebGL.js
│   ├── Telemetry.js
│   ├── Controller.js
│   └── BinaryOptimizer.js
├── /tools
│   ├── svg-to-points.js
│   ├── binary-converter.js
│   ├── video-exporter.js
│   └── path-generator.js
├── /data
│   ├── stroke-data.json
│   └── stroke-data.bin
└── /procedural
    ├── handwriting-generator.js
    ├── ai-path-feeder.js
    └── noise-injector.js
```

---

## 1. INDEX.HTML

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Vector Stroke Engine</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <canvas id="mainCanvas"></canvas>
    <canvas id="webglCanvas" style="display:none;"></canvas>
    
    <div id="controls">
        <button id="play">Play</button>
        <button id="pause">Pause</button>
        <button id="reset">Reset</button>
        <input type="range" id="speed" min="0.1" max="5" step="0.1" value="1">
        <span id="speedLabel">1.0x</span>
        <button id="exportVideo">Export Video</button>
        <button id="toggleRenderer">Switch to WebGL</button>
    </div>
    
    <div id="telemetry">
        <div id="layer"></div>
        <div id="progress"></div>
        <div id="speed-display"></div>
        <div id="fps"></div>
    </div>

    <script type="module" src="engine/DataLoader.js"></script>
    <script type="module" src="engine/Timeline.js"></script>
    <script type="module" src="engine/Renderer.js"></script>
    <script type="module" src="engine/RendererWebGL.js"></script>
    <script type="module" src="engine/Telemetry.js"></script>
    <script type="module" src="engine/Controller.js"></script>
    <script type="module" src="engine/BinaryOptimizer.js"></script>
</body>
</html>
```

---

## 2. STYLE.CSS

```css
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    background: #000;
    overflow: hidden;
    font-family: 'Courier New', monospace;
}

#mainCanvas, #webglCanvas {
    position: absolute;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
}

#controls {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.8);
    padding: 15px;
    border-radius: 8px;
    display: flex;
    gap: 10px;
    align-items: center;
    z-index: 100;
}

#controls button {
    background: #fff;
    border: none;
    padding: 8px 16px;
    border-radius: 4px;
    cursor: pointer;
    font-family: 'Courier New', monospace;
    font-weight: bold;
}

#controls button:hover {
    background: #f0f0f0;
}

#speed {
    width: 150px;
}

#speedLabel {
    color: #fff;
    min-width: 50px;
}

#telemetry {
    position: fixed;
    top: 20px;
    left: 20px;
    color: #0f0;
    font-size: 14px;
    line-height: 1.6;
    background: rgba(0, 0, 0, 0.8);
    padding: 15px;
    border-radius: 8px;
    font-family: 'Courier New', monospace;
    z-index: 100;
}

#telemetry div {
    margin-bottom: 5px;
}
```

---

## 3. ENGINE/DATALOADER.JS

```javascript
export class DataLoader {
    constructor() {
        this.data = null;
        this.binaryMode = false;
    }

    async loadJSON(url) {
        try {
            const response = await fetch(url);
            this.data = await response.json();
            this.normalizeCoordinates();
            console.log('[DataLoader] JSON loaded:', this.data.meta);
            return this.data;
        } catch (error) {
            console.error('[DataLoader] Failed to load JSON:', error);
            throw error;
        }
    }

    async loadBinary(url) {
        try {
            const response = await fetch(url);
            const buffer = await response.arrayBuffer();
            this.data = this.parseBinary(buffer);
            console.log('[DataLoader] Binary loaded:', this.data.meta);
            this.binaryMode = true;
            return this.data;
        } catch (error) {
            console.error('[DataLoader] Failed to load binary:', error);
            throw error;
        }
    }

    parseBinary(buffer) {
        const view = new DataView(buffer);
        let offset = 0;

        const metaLength = view.getUint32(offset, true);
        offset += 4;

        const metaBytes = new Uint8Array(buffer, offset, metaLength);
        const metaString = new TextDecoder().decode(metaBytes);
        const meta = JSON.parse(metaString);
        offset += metaLength;

        const layers = [];
        for (let i = 0; i < meta.layers; i++) {
            const nameLength = view.getUint16(offset, true);
            offset += 2;

            const nameBytes = new Uint8Array(buffer, offset, nameLength);
            const name = new TextDecoder().decode(nameBytes);
            offset += nameLength;

            const colorLength = view.getUint8(offset);
            offset += 1;

            const colorBytes = new Uint8Array(buffer, offset, colorLength);
            const stroke = new TextDecoder().decode(colorBytes);
            offset += colorLength;

            const pointCount = view.getUint32(offset, true);
            offset += 4;

            const points = new Float32Array(buffer, offset, pointCount * 2);
            offset += pointCount * 2 * 4;

            layers.push({
                name,
                stroke,
                points: Array.from({ length: pointCount }, (_, i) => ({
                    x: points[i * 2],
                    y: points[i * 2 + 1]
                }))
            });
        }

        return { meta, layers };
    }

    normalizeCoordinates() {
        if (!this.data) return;

        const { width, height } = this.data.meta;

        this.data.layers.forEach(layer => {
            layer.points = layer.points.map(p => ({
                x: p.x / width,
                y: p.y / height
            }));
        });
    }

    validate() {
        if (!this.data) return false;
        if (!this.data.meta) return false;
        if (!this.data.layers || this.data.layers.length === 0) return false;

        return this.data.layers.every(layer => 
            layer.points && layer.points.length > 0
        );
    }

    getTotalPoints() {
        if (!this.data) return 0;
        return this.data.layers.reduce((sum, layer) => sum + layer.points.length, 0);
    }

    getLayer(index) {
        if (!this.data || index >= this.data.layers.length) return null;
        return this.data.layers[index];
    }
}
```

---

## 4. ENGINE/TIMELINE.JS

```javascript
export class Timeline {
    constructor(totalPoints) {
        this.totalPoints = totalPoints;
        this.currentIndex = 0;
        this.speed = 1.0;
        this.isPlaying = false;
        this.startTime = null;
        this.pausedTime = 0;
        this.basePointsPerSecond = 800;
    }

    play() {
        this.isPlaying = true;
        if (!this.startTime) {
            this.startTime = performance.now();
        }
    }

    pause() {
        this.isPlaying = false;
        this.pausedTime = performance.now();
    }

    reset() {
        this.currentIndex = 0;
        this.startTime = null;
        this.pausedTime = 0;
        this.isPlaying = false;
    }

    setSpeed(multiplier) {
        this.speed = Math.max(0.1, Math.min(10, multiplier));
    }

    update(deltaTime) {
        if (!this.isPlaying) return 0;

        const pointsThisFrame = Math.ceil(
            (this.basePointsPerSecond * this.speed * deltaTime) / 1000
        );

        this.currentIndex = Math.min(
            this.currentIndex + pointsThisFrame,
            this.totalPoints
        );

        if (this.currentIndex >= this.totalPoints) {
            this.isPlaying = false;
        }

        return pointsThisFrame;
    }

    getProgress() {
        return this.currentIndex / this.totalPoints;
    }

    isComplete() {
        return this.currentIndex >= this.totalPoints;
    }

    getCurrentIndex() {
        return this.currentIndex;
    }

    getSpeed() {
        return this.speed;
    }
}
```

---

## 5. ENGINE/RENDERER.JS

```javascript
export class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: false });
        this.dpr = window.devicePixelRatio || 1;
        this.noise = 0.0005;
        this.setupCanvas();
    }

    setupCanvas() {
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width * this.dpr;
        this.canvas.height = rect.height * this.dpr;
        this.ctx.scale(this.dpr, this.dpr);
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';
    }

    clear() {
        this.ctx.fillStyle = '#000000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    setStyle(color, width) {
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = width;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
    }

    drawSegment(from, to, applyNoise = false) {
        const width = this.canvas.width / this.dpr;
        const height = this.canvas.height / this.dpr;

        let x1 = from.x * width;
        let y1 = from.y * height;
        let x2 = to.x * width;
        let y2 = to.y * height;

        if (applyNoise) {
            x1 += (Math.random() - 0.5) * this.noise * width;
            y1 += (Math.random() - 0.5) * this.noise * height;
            x2 += (Math.random() - 0.5) * this.noise * width;
            y2 += (Math.random() - 0.5) * this.noise * height;
        }

        this.ctx.beginPath();
        this.ctx.moveTo(x1, y1);
        this.ctx.lineTo(x2, y2);
        this.ctx.stroke();
    }

    drawPoints(points, startIndex, endIndex, color, width, applyNoise = false) {
        this.setStyle(color, width);

        for (let i = startIndex; i < Math.min(endIndex, points.length - 1); i++) {
            this.drawSegment(points[i], points[i + 1], applyNoise);
        }
    }

    resize() {
        this.setupCanvas();
    }

    setNoise(value) {
        this.noise = Math.max(0, Math.min(0.01, value));
    }
}
```

---

## 6. ENGINE/RENDERERWEBGL.JS

```javascript
export class RendererWebGL {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = canvas.getContext('webgl2', { 
            alpha: false,
            antialias: true,
            preserveDrawingBuffer: true
        });
        
        if (!this.gl) {
            throw new Error('WebGL2 not supported');
        }

        this.program = null;
        this.buffers = {};
        this.setupGL();
    }

    setupGL() {
        const gl = this.gl;

        const vertexShaderSource = `#version 300 es
            in vec2 a_position;
            uniform vec2 u_resolution;
            
            void main() {
                vec2 clipSpace = (a_position / u_resolution) * 2.0 - 1.0;
                gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
            }
        `;

        const fragmentShaderSource = `#version 300 es
            precision highp float;
            uniform vec4 u_color;
            out vec4 outColor;
            
            void main() {
                outColor = u_color;
            }
        `;

        const vertexShader = this.createShader(gl.VERTEX_SHADER, vertexShaderSource);
        const fragmentShader = this.createShader(gl.FRAGMENT_SHADER, fragmentShaderSource);

        this.program = this.createProgram(vertexShader, fragmentShader);

        this.locations = {
            position: gl.getAttribLocation(this.program, 'a_position'),
            resolution: gl.getUniformLocation(this.program, 'u_resolution'),
            color: gl.getUniformLocation(this.program, 'u_color')
        };

        this.buffers.position = gl.createBuffer();
        
        this.resize();
        gl.clearColor(0, 0, 0, 1);
    }

    createShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compile error:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }

        return shader;
    }

    createProgram(vertexShader, fragmentShader) {
        const gl = this.gl;
        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('Program link error:', gl.getProgramInfoLog(program));
            gl.deleteProgram(program);
            return null;
        }

        return program;
    }

    clear() {
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }

    drawSegment(from, to, color, width) {
        const gl = this.gl;
        const positions = new Float32Array([
            from.x * this.canvas.width, from.y * this.canvas.height,
            to.x * this.canvas.width, to.y * this.canvas.height
        ]);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

        gl.useProgram(this.program);
        
        gl.enableVertexAttribArray(this.locations.position);
        gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, 0, 0);

        gl.uniform2f(this.locations.resolution, this.canvas.width, this.canvas.height);
        
        const rgb = this.hexToRgb(color);
        gl.uniform4f(this.locations.color, rgb.r, rgb.g, rgb.b, 1.0);

        gl.lineWidth(width);
        gl.drawArrays(gl.LINES, 0, 2);
    }

    drawPoints(points, startIndex, endIndex, color, width) {
        for (let i = startIndex; i < Math.min(endIndex, points.length - 1); i++) {
            this.drawSegment(points[i], points[i + 1], color, width);
        }
    }

    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16) / 255,
            g: parseInt(result[2], 16) / 255,
            b: parseInt(result[3], 16) / 255
        } : { r: 1, g: 1, b: 1 };
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
}
```

---

## 7. ENGINE/TELEMETRY.JS

```javascript
export class Telemetry {
    constructor() {
        this.metrics = {
            currentLayer: '',
            currentPoint: 0,
            totalPoints: 0,
            pointsPerSecond: 0,
            fps: 0,
            speed: 1.0
        };

        this.frameCount = 0;
        this.lastTime = performance.now();
        this.lastPointCount = 0;

        this.elements = {
            layer: document.getElementById('layer'),
            progress: document.getElementById('progress'),
            speedDisplay: document.getElementById('speed-display'),
            fps: document.getElementById('fps')
        };
    }

    update(currentLayer, currentPoint, totalPoints, speed) {
        const now = performance.now();
        const deltaTime = now - this.lastTime;

        this.metrics.currentLayer = currentLayer;
        this.metrics.currentPoint = currentPoint;
        this.metrics.totalPoints = totalPoints;
        this.metrics.speed = speed;

        if (deltaTime >= 1000) {
            this.metrics.pointsPerSecond = Math.round(
                ((currentPoint - this.lastPointCount) / deltaTime) * 1000
            );
            this.metrics.fps = Math.round((this.frameCount / deltaTime) * 1000);

            this.lastTime = now;
            this.lastPointCount = currentPoint;
            this.frameCount = 0;

            this.render();
            this.logToConsole();
        }

        this.frameCount++;
    }

    render() {
        if (this.elements.layer) {
            this.elements.layer.textContent = `[LAYER] ${this.metrics.currentLayer}`;
        }
        if (this.elements.progress) {
            this.elements.progress.textContent = 
                `[DRAW] ${this.metrics.currentPoint} / ${this.metrics.totalPoints}`;
        }
        if (this.elements.speedDisplay) {
            this.elements.speedDisplay.textContent = 
                `[SPEED] ${this.metrics.pointsPerSecond} pts/sec`;
        }
        if (this.elements.fps) {
            this.elements.fps.textContent = `[FPS] ${this.metrics.fps}`;
        }
    }

    logToConsole() {
        console.log(
            `[ENGINE] Layer: ${this.metrics.currentLayer} | ` +
            `${this.metrics.currentPoint}/${this.metrics.totalPoints} | ` +
            `${this.metrics.pointsPerSecond} pts/sec | ` +
            `${this.metrics.fps} FPS | ` +
            `${this.metrics.speed.toFixed(1)}x`
        );
    }

    reset() {
        this.frameCount = 0;
        this.lastTime = performance.now();
        this.lastPointCount = 0;
    }
}
```

---

## 8. ENGINE/CONTROLLER.JS

```javascript
import { DataLoader } from './DataLoader.js';
import { Timeline } from './Timeline.js';
import { Renderer } from './Renderer.js';
import { RendererWebGL } from './RendererWebGL.js';
import { Telemetry } from './Telemetry.js';

export class Controller {
    constructor() {
        this.dataLoader = new DataLoader();
        this.timeline = null;
        this.renderer = null;
        this.rendererWebGL = null;
        this.telemetry = new Telemetry();
        
        this.currentLayerIndex = 0;
        this.pointsDrawnInLayer = 0;
        this.useWebGL = false;
        
        this.lastFrameTime = performance.now();
        
        this.init();
    }

    async init() {
        try {
            await this.dataLoader.loadJSON('data/stroke-data.json');
            
            if (!this.dataLoader.validate()) {
                throw new Error('Invalid data format');
            }

            const totalPoints = this.dataLoader.getTotalPoints();
            this.timeline = new Timeline(totalPoints);

            const canvas = document.getElementById('mainCanvas');
            const webglCanvas = document.getElementById('webglCanvas');
            
            this.renderer = new Renderer(canvas);
            this.rendererWebGL = new RendererWebGL(webglCanvas);

            this.renderer.clear();
            
            this.setupControls();
            this.setupResize();
            
            console.log('[Controller] Initialized successfully');
            console.log('[Controller] Total points:', totalPoints);
            
        } catch (error) {
            console.error('[Controller] Initialization failed:', error);
        }
    }

    setupControls() {
        document.getElementById('play').addEventListener('click', () => {
            this.timeline.play();
            this.animate();
        });

        document.getElementById('pause').addEventListener('click', () => {
            this.timeline.pause();
        });

        document.getElementById('reset').addEventListener('click', () => {
            this.reset();
        });

        const speedControl = document.getElementById('speed');
        const speedLabel = document.getElementById('speedLabel');
        
        speedControl.addEventListener('input', (e) => {
            const speed = parseFloat(e.target.value);
            this.timeline.setSpeed(speed);
            speedLabel.textContent = speed.toFixed(1) + 'x';
        });

        document.getElementById('toggleRenderer').addEventListener('click', () => {
            this.toggleRenderer();
        });

        document.getElementById('exportVideo')?.addEventListener('click', () => {
            this.exportVideo();
        });
    }

    setupResize() {
        window.addEventListener('resize', () => {
            this.renderer.resize();
            this.rendererWebGL.resize();
        });
    }

    animate() {
        if (!this.timeline.isPlaying) return;

        const now = performance.now();
        const deltaTime = now - this.lastFrameTime;
        this.lastFrameTime = now;

        const pointsThisFrame = this.timeline.update(deltaTime);
        
        if (pointsThisFrame > 0) {
            this.draw(pointsThisFrame);
        }

        const currentLayer = this.dataLoader.getLayer(this.currentLayerIndex);
        this.telemetry.update(
            currentLayer?.name || 'unknown',
            this.timeline.getCurrentIndex(),
            this.timeline.totalPoints,
            this.timeline.getSpeed()
        );

        requestAnimationFrame(() => this.animate());
    }

    draw(pointsThisFrame) {
        let pointsRemaining = pointsThisFrame;

        while (pointsRemaining > 0 && this.currentLayerIndex < this.dataLoader.data.layers.length) {
            const layer = this.dataLoader.getLayer(this.currentLayerIndex);
            const pointsInLayer = layer.points.length;
            const pointsToDrawInLayer = Math.min(
                pointsRemaining,
                pointsInLayer - this.pointsDrawnInLayer
            );

            const startIndex = this.pointsDrawnInLayer;
            const endIndex = startIndex + pointsToDrawInLayer;

            const activeRenderer = this.useWebGL ? this.rendererWebGL : this.renderer;
            
            activeRenderer.drawPoints(
                layer.points,
                startIndex,
                endIndex,
                layer.stroke,
                2,
                true
            );

            this.pointsDrawnInLayer += pointsToDrawInLayer;
            pointsRemaining -= pointsToDrawInLayer;

            if (this.pointsDrawnInLayer >= pointsInLayer) {
                this.currentLayerIndex++;
                this.pointsDrawnInLayer = 0;
            }
        }
    }

    reset() {
        this.timeline.reset();
        this.currentLayerIndex = 0;
        this.pointsDrawnInLayer = 0;
        this.telemetry.reset();
        
        const activeRenderer = this.useWebGL ? this.rendererWebGL : this.renderer;
        activeRenderer.clear();
        
        this.lastFrameTime = performance.now();
    }

    toggleRenderer() {
        this.useWebGL = !this.useWebGL;
        
        const canvas = document.getElementById('mainCanvas');
        const webglCanvas = document.getElementById('webglCanvas');
        
        if (this.useWebGL) {
            canvas.style.display = 'none';
            webglCanvas.style.display = 'block';
            document.getElementById('toggleRenderer').textContent = 'Switch to Canvas';
        } else {
            canvas.style.display = 'block';
            webglCanvas.style.display = 'none';
            document.getElementById('toggleRenderer').textContent = 'Switch to WebGL';
        }
        
        this.reset();
    }

    exportVideo() {
        console.log('[Controller] Video export not implemented yet');
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new Controller();
});
```

---

## 9. ENGINE/BINARYOPTIMIZER.JS

```javascript
export class BinaryOptimizer {
    static jsonToBinary(jsonData) {
        const metaString = JSON.stringify(jsonData.meta);
        const metaBytes = new TextEncoder().encode(metaString);
        
        let totalSize = 4 + metaBytes.length;

        const layerData = [];
        jsonData.layers.forEach(layer => {
            const nameBytes = new TextEncoder().encode(layer.name);
            const colorBytes = new TextEncoder().encode(layer.stroke);
            const pointCount = layer.points.length;
            
            layerData.push({
                nameBytes,
                colorBytes,
                pointCount,
                points: layer.points
            });

            totalSize += 2 + nameBytes.length;
            totalSize += 1 + colorBytes.length;
            totalSize += 4;
            totalSize += pointCount * 2 * 4;
        });

        const buffer = new ArrayBuffer(totalSize);
        const view = new DataView(buffer);
        let offset = 0;

        view.setUint32(offset, metaBytes.length, true);
        offset += 4;

        new Uint8Array(buffer, offset, metaBytes.length).set(metaBytes);
        offset += metaBytes.length;

        layerData.forEach(layer => {
            view.setUint16(offset, layer.nameBytes.length, true);
            offset += 2;

            new Uint8Array(buffer, offset, layer.nameBytes.length).set(layer.nameBytes);
            offset += layer.nameBytes.length;

            view.setUint8(offset, layer.colorBytes.length);
            offset += 1;

            new Uint8Array(buffer, offset, layer.colorBytes.length).set(layer.colorBytes);
            offset += layer.colorBytes.length;

            view.setUint32(offset, layer.pointCount, true);
            offset += 4;

            const pointsArray = new Float32Array(buffer, offset, layer.pointCount * 2);
            layer.points.forEach((point, i) => {
                pointsArray[i * 2] = point.x;
                pointsArray[i * 2 + 1] = point.y;
            });
            offset += layer.pointCount * 2 * 4;
        });

        return buffer;
    }

    static downloadBinary(buffer, filename = 'stroke-data.bin') {
        const blob = new Blob([buffer], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    static async convertJSONFileToBinary(jsonUrl) {
        const response = await fetch(jsonUrl);
        const jsonData = await response.json();
        const buffer = BinaryOptimizer.jsonToBinary(jsonData);
        
        const originalSize = JSON.stringify(jsonData).length;
        const binarySize = buffer.byteLength;
        const reduction = ((1 - binarySize / originalSize) * 100).toFixed(1);
        
        console.log(`[BinaryOptimizer] Original: ${originalSize} bytes`);
        console.log(`[BinaryOptimizer] Binary: ${binarySize} bytes`);
        console.log(`[BinaryOptimizer] Reduction: ${reduction}%`);
        
        return buffer;
    }
}
```

---

## 10. TOOLS/SVG-TO-POINTS.JS

```javascript
const fs = require('fs');
const { DOMParser } = require('xmldom');
const { parse } = require('svg-parser');

class SVGToPoints {
    constructor(svgPath, options = {}) {
        this.svgPath = svgPath;
        this.samplingDensity = options.samplingDensity || 0.5;
        this.layers = [];
    }

    async convert() {
        const svgContent = fs.readFileSync(this.svgPath, 'utf-8');
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgContent, 'image/svg+xml');
        
        const svg = doc.documentElement;
        const width = parseFloat(svg.getAttribute('width') || 1024);
        const height = parseFloat(svg.getAttribute('height') || 1024);

        this.extractLayers(svg);

        const output = {
            meta: {
                width,
                height,
                totalPoints: this.getTotalPoints(),
                layers: this.layers.length
            },
            layers: this.layers
        };

        return output;
    }

    extractLayers(svg) {
        const groups = svg.getElementsByTagName('g');
        
        for (let i = 0; i < groups.length; i++) {
            const group = groups[i];
            const layerName = group.getAttribute('id') || `layer_${i}`;
            const paths = group.getElementsByTagName('path');
            
            const points = [];
            for (let j = 0; j < paths.length; j++) {
                const pathData = paths[j].getAttribute('d');
                const pathPoints = this.parsePath(pathData);
                points.push(...pathPoints);
            }

            const stroke = group.getAttribute('stroke') || '#ffffff';

            this.layers.push({
                name: layerName,
                stroke,
                points
            });
        }
    }

    parsePath(pathData) {
        const points = [];
        const commands = this.tokenizePath(pathData);
        let currentX = 0;
        let currentY = 0;
        let startX = 0;
        let startY = 0;

        for (const cmd of commands) {
            switch (cmd.type) {
                case 'M':
                    currentX = cmd.x;
                    currentY = cmd.y;
                    startX = currentX;
                    startY = currentY;
                    points.push({ x: currentX, y: currentY });
                    break;

                case 'L':
                    const linePoints = this.sampleLine(
                        currentX, currentY,
                        cmd.x, cmd.y
                    );
                    points.push(...linePoints);
                    currentX = cmd.x;
                    currentY = cmd.y;
                    break;

                case 'C':
                    const curvePoints = this.sampleCubicBezier(
                        currentX, currentY,
                        cmd.x1, cmd.y1,
                        cmd.x2, cmd.y2,
                        cmd.x, cmd.y
                    );
                    points.push(...curvePoints);
                    currentX = cmd.x;
                    currentY = cmd.y;
                    break;

                case 'Q':
                    const quadPoints = this.sampleQuadraticBezier(
                        currentX, currentY,
                        cmd.x1, cmd.y1,
                        cmd.x, cmd.y
                    );
                    points.push(...quadPoints);
                    currentX = cmd.x;
                    currentY = cmd.y;
                    break;

                case 'Z':
                    const closePoints = this.sampleLine(
                        currentX, currentY,
                        startX, startY
                    );
                    points.push(...closePoints);
                    currentX = startX;
                    currentY = startY;
                    break;
            }
        }

        return points;
    }

    tokenizePath(pathData) {
        const commands = [];
        const tokens = pathData.match(/[a-zA-Z][^a-zA-Z]*/g);

        tokens?.forEach(token => {
            const type = token[0].toUpperCase();
            const values = token.slice(1).trim().split(/[\s,]+/).map(parseFloat);

            switch (type) {
                case 'M':
                case 'L':
                    commands.push({ type, x: values[0], y: values[1] });
                    break;
                case 'C':
                    commands.push({
                        type,
                        x1: values[0], y1: values[1],
                        x2: values[2], y2: values[3],
                        x: values[4], y: values[5]
                    });
                    break;
                case 'Q':
                    commands.push({
                        type,
                        x1: values[0], y1: values[1],
                        x: values[2], y: values[3]
                    });
                    break;
                case 'Z':
                    commands.push({ type: 'Z' });
                    break;
            }
        });

        return commands;
    }

    sampleLine(x1, y1, x2, y2) {
        const points = [];
        const distance = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
        const steps = Math.max(2, Math.ceil(distance * this.samplingDensity));

        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            points.push({
                x: x1 + (x2 - x1) * t,
                y: y1 + (y2 - y1) * t
            });
        }

        return points;
    }

    sampleCubicBezier(x0, y0, x1, y1, x2, y2, x3, y3) {
        const points = [];
        const steps = Math.ceil(50 * this.samplingDensity);

        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const t2 = t * t;
            const t3 = t2 * t;
            const mt = 1 - t;
            const mt2 = mt * mt;
            const mt3 = mt2 * mt;

            const x = mt3 * x0 + 3 * mt2 * t * x1 + 3 * mt * t2 * x2 + t3 * x3;
            const y = mt3 * y0 + 3 * mt2 * t * y1 + 3 * mt * t2 * y2 + t3 * y3;

            points.push({ x, y });
        }

        return points;
    }

    sampleQuadraticBezier(x0, y0, x1, y1, x2, y2) {
        const points = [];
        const steps = Math.ceil(30 * this.samplingDensity);

        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const t2 = t * t;
            const mt = 1 - t;
            const mt2 = mt * mt;

            const x = mt2 * x0 + 2 * mt * t * x1 + t2 * x2;
            const y = mt2 * y0 + 2 * mt * t * y1 + t2 * y2;

            points.push({ x, y });
        }

        return points;
    }

    getTotalPoints() {
        return this.layers.reduce((sum, layer) => sum + layer.points.length, 0);
    }

    saveJSON(outputPath) {
        const json = JSON.stringify(this.data, null, 2);
        fs.writeFileSync(outputPath, json);
        console.log(`[SVGToPoints] Saved to ${outputPath}`);
        console.log(`[SVGToPoints] Total points: ${this.getTotalPoints()}`);
    }
}

async function main() {
    const converter = new SVGToPoints('input.svg', {
        samplingDensity: 0.5
    });

    const data = await converter.convert();
    
    fs.writeFileSync('stroke-data.json', JSON.stringify(data, null, 2));
    
    console.log('[SVGToPoints] Conversion complete');
    console.log(`[SVGToPoints] Layers: ${data.meta.layers}`);
    console.log(`[SVGToPoints] Points: ${data.meta.totalPoints}`);
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { SVGToPoints };
```

---

## 11. TOOLS/BINARY-CONVERTER.JS

```javascript
const fs = require('fs');
const { BinaryOptimizer } = require('../engine/BinaryOptimizer.js');

async function convertToBinary(jsonPath, outputPath = 'stroke-data.bin') {
    const jsonContent = fs.readFileSync(jsonPath, 'utf-8');
    const jsonData = JSON.parse(jsonContent);
    
    const buffer = BinaryOptimizer.jsonToBinary(jsonData);
    
    fs.writeFileSync(outputPath, Buffer.from(buffer));
    
    const originalSize = jsonContent.length;
    const binarySize = buffer.byteLength;
    const reduction = ((1 - binarySize / originalSize) * 100).toFixed(1);
    
    console.log(`[BinaryConverter] Original JSON: ${originalSize} bytes`);
    console.log(`[BinaryConverter] Binary output: ${binarySize} bytes`);
    console.log(`[BinaryConverter] Size reduction: ${reduction}%`);
    console.log(`[BinaryConverter] Saved to: ${outputPath}`);
}

if (require.main === module) {
    const jsonPath = process.argv[2] || 'stroke-data.json';
    const outputPath = process.argv[3] || 'stroke-data.bin';
    
    convertToBinary(jsonPath, outputPath).catch(console.error);
}

module.exports = { convertToBinary };
```

---

## 12. TOOLS/VIDEO-EXPORTER.JS

```javascript
class VideoExporter {
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.fps = options.fps || 60;
        this.duration = options.duration || 10;
        this.codec = options.codec || 'vp9';
        this.quality = options.quality || 0.95;
        
        this.mediaRecorder = null;
        this.chunks = [];
    }

    async startRecording() {
        const stream = this.canvas.captureStream(this.fps);
        
        const options = {
            mimeType: this.getMimeType(),
            videoBitsPerSecond: 8000000
        };

        this.mediaRecorder = new MediaRecorder(stream, options);
        
        this.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                this.chunks.push(event.data);
            }
        };

        this.mediaRecorder.onstop = () => {
            this.download();
        };

        this.mediaRecorder.start();
        console.log('[VideoExporter] Recording started');
    }

    stopRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
            console.log('[VideoExporter] Recording stopped');
        }
    }

    download() {
        const blob = new Blob(this.chunks, { type: this.getMimeType() });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `stroke-render-${Date.now()}.webm`;
        a.click();
        
        URL.revokeObjectURL(url);
        this.chunks = [];
        
        console.log('[VideoExporter] Video downloaded');
    }

    getMimeType() {
        const types = [
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm',
            'video/mp4'
        ];

        for (const type of types) {
            if (MediaRecorder.isTypeSupported(type)) {
                return type;
            }
        }

        return 'video/webm';
    }

    async exportFrames(controller, outputCallback) {
        const totalFrames = this.duration * this.fps;
        const frames = [];

        controller.reset();
        controller.timeline.play();

        for (let i = 0; i < totalFrames; i++) {
            await new Promise(resolve => {
                requestAnimationFrame(() => {
                    controller.animate();
                    
                    this.canvas.toBlob((blob) => {
                        frames.push(blob);
                        if (outputCallback) {
                            outputCallback(i + 1, totalFrames);
                        }
                        resolve();
                    }, 'image/png', this.quality);
                });
            });
        }

        return frames;
    }

    async createVideo(frames) {
        console.log('[VideoExporter] Creating video from frames...');
        console.log('[VideoExporter] Total frames:', frames.length);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VideoExporter };
}
```

---

## 13. TOOLS/PATH-GENERATOR.JS

```javascript
class PathGenerator {
    static generateCircle(centerX, centerY, radius, points = 100) {
        const result = [];
        for (let i = 0; i <= points; i++) {
            const angle = (i / points) * Math.PI * 2;
            result.push({
                x: centerX + Math.cos(angle) * radius,
                y: centerY + Math.sin(angle) * radius
            });
        }
        return result;
    }

    static generateSpiral(centerX, centerY, turns, points = 500) {
        const result = [];
        for (let i = 0; i <= points; i++) {
            const t = i / points;
            const angle = t * turns * Math.PI * 2;
            const radius = t * 200;
            result.push({
                x: centerX + Math.cos(angle) * radius,
                y: centerY + Math.sin(angle) * radius
            });
        }
        return result;
    }

    static generateWave(startX, startY, width, amplitude, frequency, points = 200) {
        const result = [];
        for (let i = 0; i <= points; i++) {
            const t = i / points;
            const x = startX + t * width;
            const y = startY + Math.sin(t * frequency * Math.PI * 2) * amplitude;
            result.push({ x, y });
        }
        return result;
    }

    static generateLissajous(centerX, centerY, a, b, delta, scale, points = 500) {
        const result = [];
        for (let i = 0; i <= points; i++) {
            const t = (i / points) * Math.PI * 2;
            const x = centerX + Math.sin(a * t + delta) * scale;
            const y = centerY + Math.sin(b * t) * scale;
            result.push({ x, y });
        }
        return result;
    }

    static generateRandomWalk(startX, startY, steps, stepSize) {
        const result = [{ x: startX, y: startY }];
        let x = startX;
        let y = startY;

        for (let i = 0; i < steps; i++) {
            const angle = Math.random() * Math.PI * 2;
            x += Math.cos(angle) * stepSize;
            y += Math.sin(angle) * stepSize;
            result.push({ x, y });
        }

        return result;
    }

    static generatePerlinPath(startX, startY, length, points = 300) {
        const result = [];
        let x = startX;
        let y = startY;

        for (let i = 0; i <= points; i++) {
            const t = i / points;
            const noise = this.perlin(t * 10) * 50;
            
            x += length / points;
            y = startY + noise;
            
            result.push({ x, y });
        }

        return result;
    }

    static perlin(x) {
        const xi = Math.floor(x);
        const xf = x - xi;
        const u = this.fade(xf);

        const a = this.grad(xi, xf);
        const b = this.grad(xi + 1, xf - 1);

        return this.lerp(u, a, b);
    }

    static fade(t) {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    static lerp(t, a, b) {
        return a + t * (b - a);
    }

    static grad(hash, x) {
        const h = hash & 15;
        const grad = 1 + (h & 7);
        return ((h & 8) ? -grad : grad) * x;
    }

    static applyNoise(points, amount = 1) {
        return points.map(p => ({
            x: p.x + (Math.random() - 0.5) * amount,
            y: p.y + (Math.random() - 0.5) * amount
        }));
    }

    static smooth(points, iterations = 1) {
        let result = [...points];

        for (let iter = 0; iter < iterations; iter++) {
            const smoothed = [result[0]];

            for (let i = 1; i < result.length - 1; i++) {
                smoothed.push({
                    x: (result[i - 1].x + result[i].x + result[i + 1].x) / 3,
                    y: (result[i - 1].y + result[i].y + result[i + 1].y) / 3
                });
            }

            smoothed.push(result[result.length - 1]);
            result = smoothed;
        }

        return result;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PathGenerator };
}
```

---

## 14. PROCEDURAL/HANDWRITING-GENERATOR.JS

```javascript
import { PathGenerator } from '../tools/path-generator.js';

export class HandwritingGenerator {
    constructor() {
        this.baselineY = 300;
        this.xHeight = 40;
        this.ascenderHeight = 60;
        this.descenderHeight = 60;
        this.letterSpacing = 50;
        this.wordSpacing = 100;
    }

    generateText(text, startX = 100) {
        const layers = [];
        let currentX = startX;

        const words = text.split(' ');

        words.forEach((word, wordIndex) => {
            const wordPoints = [];

            for (let i = 0; i < word.length; i++) {
                const char = word[i];
                const charPoints = this.generateCharacter(char, currentX, this.baselineY);
                wordPoints.push(...charPoints);
                currentX += this.letterSpacing;
            }

            layers.push({
                name: `word_${wordIndex}`,
                stroke: '#ffffff',
                points: PathGenerator.applyNoise(wordPoints, 0.5)
            });

            currentX += this.wordSpacing;
        });

        return {
            meta: {
                width: currentX,
                height: 600,
                totalPoints: layers.reduce((sum, l) => sum + l.points.length, 0),
                layers: layers.length
            },
            layers
        };
    }

    generateCharacter(char, x, y) {
        const generators = {
            'a': () => this.generateA(x, y),
            'b': () => this.generateB(x, y),
            'c': () => this.generateC(x, y),
            'e': () => this.generateE(x, y),
            'l': () => this.generateL(x, y),
            'o': () => this.generateO(x, y),
            'h': () => this.generateH(x, y)
        };

        return generators[char.toLowerCase()]?.() || this.generateDefault(x, y);
    }

    generateA(x, y) {
        return [
            ...PathGenerator.generateCircle(x + 15, y - 20, 15, 30),
            { x: x + 30, y: y - 35 },
            { x: x + 30, y: y }
        ];
    }

    generateB(x, y) {
        return [
            { x, y: y - this.ascenderHeight },
            { x, y },
            ...PathGenerator.generateCircle(x + 15, y - 20, 15, 30)
        ];
    }

    generateC(x, y) {
        const points = PathGenerator.generateCircle(x + 15, y - 20, 15, 40);
        return points.slice(10, 35);
    }

    generateE(x, y) {
        return [
            ...PathGenerator.generateCircle(x + 15, y - 20, 15, 40),
            { x: x + 10, y: y - 20 }
        ];
    }

    generateL(x, y) {
        return [
            { x, y: y - this.ascenderHeight },
            { x, y }
        ];
    }

    generateO(x, y) {
        return PathGenerator.generateCircle(x + 15, y - 20, 15, 40);
    }

    generateH(x, y) {
        return [
            { x, y: y - this.ascenderHeight },
            { x, y },
            { x, y: y - 20 },
            { x: x + 20, y: y - 20 },
            { x: x + 20, y: y - 35 },
            { x: x + 20, y: y }
        ];
    }

    generateDefault(x, y) {
        return [
            { x, y: y - this.xHeight },
            { x, y }
        ];
    }

    generateSignature(name, startX, startY) {
        const points = [];
        let x = startX;

        for (let i = 0; i < name.length; i++) {
            const char = name[i];
            const charPoints = this.generateCharacter(char, x, startY);
            points.push(...charPoints);
            x += this.letterSpacing * 1.5;
        }

        const signature = PathGenerator.smooth(points, 3);
        const withNoise = PathGenerator.applyNoise(signature, 1.5);
        
        const flourish = PathGenerator.generateSpiral(x, startY, 1.5, 50);
        
        return [...withNoise, ...flourish];
    }
}
```

---

## 15. PROCEDURAL/AI-PATH-FEEDER.JS

```javascript
export class AIPathFeeder {
    constructor() {
        this.apiEndpoint = 'https://api.example.com/generate-path';
        this.cache = new Map();
    }

    async generateFromPrompt(prompt, options = {}) {
        const cacheKey = `${prompt}-${JSON.stringify(options)}`;
        
        if (this.cache.has(cacheKey)) {
            console.log('[AIPathFeeder] Using cached result');
            return this.cache.get(cacheKey);
        }

        const payload = {
            prompt,
            style: options.style || 'portrait',
            complexity: options.complexity || 'medium',
            layers: options.layers || 3,
            pointDensity: options.pointDensity || 50000
        };

        try {
            const response = await fetch(this.apiEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            const processed = this.processAIResponse(data);
            
            this.cache.set(cacheKey, processed);
            return processed;

        } catch (error) {
            console.error('[AIPathFeeder] Generation failed:', error);
            return this.getFallbackData();
        }
    }

    processAIResponse(data) {
        return {
            meta: {
                width: data.dimensions?.width || 1024,
                height: data.dimensions?.height || 1024,
                totalPoints: this.countPoints(data.paths),
                layers: data.paths?.length || 0,
                aiGenerated: true,
                timestamp: Date.now()
            },
            layers: data.paths.map((path, i) => ({
                name: path.label || `ai_layer_${i}`,
                stroke: path.color || '#ffffff',
                points: path.coordinates.map(coord => ({
                    x: coord[0],
                    y: coord[1]
                }))
            }))
        };
    }

    countPoints(paths) {
        return paths.reduce((sum, path) => sum + path.coordinates.length, 0);
    }

    async enhanceExistingData(strokeData, enhancement = 'detail') {
        const enhancements = {
            detail: (layer) => this.addDetailPoints(layer),
            smooth: (layer) => this.smoothLayer(layer),
            stylize: (layer) => this.stylizeLayer(layer)
        };

        const enhancer = enhancements[enhancement];
        if (!enhancer) return strokeData;

        const enhancedLayers = strokeData.layers.map(enhancer);

        return {
            ...strokeData,
            meta: {
                ...strokeData.meta,
                enhanced: true,
                enhancementType: enhancement
            },
            layers: enhancedLayers
        };
    }

    addDetailPoints(layer) {
        const enhanced = [];
        
        for (let i = 0; i < layer.points.length - 1; i++) {
            enhanced.push(layer.points[i]);
            
            const mid = {
                x: (layer.points[i].x + layer.points[i + 1].x) / 2,
                y: (layer.points[i].y + layer.points[i + 1].y) / 2
            };
            enhanced.push(mid);
        }
        
        enhanced.push(layer.points[layer.points.length - 1]);
        
        return { ...layer, points: enhanced };
    }

    smoothLayer(layer) {
        const smoothed = [layer.points[0]];
        
        for (let i = 1; i < layer.points.length - 1; i++) {
            const prev = layer.points[i - 1];
            const curr = layer.points[i];
            const next = layer.points[i + 1];
            
            smoothed.push({
                x: (prev.x + curr.x + next.x) / 3,
                y: (prev.y + curr.y + next.y) / 3
            });
        }
        
        smoothed.push(layer.points[layer.points.length - 1]);
        
        return { ...layer, points: smoothed };
    }

    stylizeLayer(layer) {
        return {
            ...layer,
            points: layer.points.map(p => ({
                x: p.x + (Math.random() - 0.5) * 0.002,
                y: p.y + (Math.random() - 0.5) * 0.002
            }))
        };
    }

    getFallbackData() {
        console.log('[AIPathFeeder] Using fallback data');
        return {
            meta: {
                width: 1024,
                height: 1024,
                totalPoints: 1000,
                layers: 1,
                fallback: true
            },
            layers: [{
                name: 'fallback',
                stroke: '#ffffff',
                points: this.generateFallbackPoints()
            }]
        };
    }

    generateFallbackPoints() {
        const points = [];
        const centerX = 0.5;
        const centerY = 0.5;
        const radius = 0.3;
        
        for (let i = 0; i <= 100; i++) {
            const angle = (i / 100) * Math.PI * 2;
            points.push({
                x: centerX + Math.cos(angle) * radius,
                y: centerY + Math.sin(angle) * radius
            });
        }
        
        return points;
    }
}
```

---

## 16. PROCEDURAL/NOISE-INJECTOR.JS

```javascript
export class NoiseInjector {
    constructor() {
        this.perlinSeed = Math.random() * 1000;
        this.permutation = this.generatePermutation();
    }

    generatePermutation() {
        const p = [];
        for (let i = 0; i < 256; i++) p[i] = i;
        
        for (let i = 255; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [p[i], p[j]] = [p[j], p[i]];
        }
        
        return [...p, ...p];
    }

    perlin2D(x, y) {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;
        
        x -= Math.floor(x);
        y -= Math.floor(y);
        
        const u = this.fade(x);
        const v = this.fade(y);
        
        const a = this.permutation[X] + Y;
        const b = this.permutation[X + 1] + Y;
        
        return this.lerp(v,
            this.lerp(u, this.grad(this.permutation[a], x, y),
                         this.grad(this.permutation[b], x - 1, y)),
            this.lerp(u, this.grad(this.permutation[a + 1], x, y - 1),
                         this.grad(this.permutation[b + 1], x - 1, y - 1))
        );
    }

    fade(t) {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    lerp(t, a, b) {
        return a + t * (b - a);
    }

    grad(hash, x, y) {
        const h = hash & 15;
        const u = h < 8 ? x : y;
        const v = h < 4 ? y : h === 12 || h === 14 ? x : 0;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }

    injectUniform(points, amount = 0.001) {
        return points.map(p => ({
            x: p.x + (Math.random() - 0.5) * amount,
            y: p.y + (Math.random() - 0.5) * amount
        }));
    }

    injectPerlin(points, scale = 0.1, amplitude = 0.002) {
        return points.map((p, i) => {
            const noiseX = this.perlin2D(i * scale, 0) * amplitude;
            const noiseY = this.perlin2D(0, i * scale) * amplitude;
            
            return {
                x: p.x + noiseX,
                y: p.y + noiseY
            };
        });
    }

    injectDirectional(points, direction = 'vertical', amount = 0.001) {
        return points.map(p => {
            const noise = (Math.random() - 0.5) * amount;
            
            return direction === 'vertical' 
                ? { x: p.x, y: p.y + noise }
                : { x: p.x + noise, y: p.y };
        });
    }

    injectTemporal(points, frequency = 0.1, amplitude = 0.001) {
        const time = Date.now() * 0.001;
        
        return points.map((p, i) => ({
            x: p.x + Math.sin(time + i * frequency) * amplitude,
            y: p.y + Math.cos(time + i * frequency) * amplitude
        }));
    }

    injectPressureSensitive(points, pressureMap) {
        return points.map((p, i) => {
            const pressure = pressureMap?.[i] || 1.0;
            const variation = (1 - pressure) * 0.002;
            
            return {
                x: p.x + (Math.random() - 0.5) * variation,
                y: p.y + (Math.random() - 0.5) * variation
            };
        });
    }

    createPressureMap(length, profile = 'natural') {
        const profiles = {
            natural: (t) => Math.sin(t * Math.PI) * 0.5 + 0.5,
            constant: () => 1.0,
            fade: (t) => 1 - t,
            pulse: (t) => Math.abs(Math.sin(t * Math.PI * 4))
        };
        
        const generator = profiles[profile] || profiles.natural;
        return Array.from({ length }, (_, i) => generator(i / length));
    }
}
```

---

## 17. PACKAGE.JSON

```json
{
  "name": "vector-stroke-engine",
  "version": "1.0.0",
  "description": "Data-driven vector stroke rendering engine",
  "main": "engine/Controller.js",
  "type": "module",
  "scripts": {
    "dev": "node tools/dev-server.js",
    "convert": "node tools/svg-to-points.js",
    "binary": "node tools/binary-converter.js",
    "test": "node tools/test-pipeline.js"
  },
  "dependencies": {
    "xmldom": "^0.6.0",
    "svg-parser": "^2.0.4"
  },
  "devDependencies": {
    "http-server": "^14.1.1"
  },
  "keywords": [
    "vector",
    "canvas",
    "webgl",
    "rendering",
    "animation"
  ],
  "author": "",
  "license": "MIT"
}
```

---

## 18. USAGE EXAMPLES

### Convert SVG to Points
```bash
node tools/svg-to-points.js input.svg stroke-data.json
```

### Convert to Binary
```bash
node tools/binary-converter.js stroke-data.json stroke-data.bin
```

### Generate Procedural Handwriting
```javascript
import { HandwritingGenerator } from './procedural/handwriting-generator.js';

const generator = new HandwritingGenerator();
const data = generator.generateText('Hello World', 100);
```

### Use AI Path Generator
```javascript
import { AIPathFeeder } from './procedural/ai-path-feeder.js';

const ai = new AIPathFeeder();
const data = await ai.generateFromPrompt('portrait of Einstein', {
    style: 'sketch',
    complexity: 'high',
    pointDensity: 80000
});
```

### Export Video
```javascript
import { VideoExporter } from './tools/video-exporter.js';

const canvas = document.getElementById('mainCanvas');
const exporter = new VideoExporter(canvas, { fps: 60, duration: 15 });
await exporter.startRecording();
// ... animate
exporter.stopRecording();
```

---

## 19. DATA SAMPLE (stroke-data.json)

```json
{
  "meta": {
    "width": 1024,
    "height": 1024,
    "totalPoints": 48732,
    "layers": 5
  },
  "layers": [
    {
      "name": "outline",
      "stroke": "#ffffff",
      "points": [
        { "x": 0.234, "y": 0.182 },
        { "x": 0.235, "y": 0.183 },
        { "x": 0.236, "y": 0.184 }
      ]
    },
    {
      "name": "eyes",
      "stroke": "#ff4444",
      "points": [
        { "x": 0.402, "y": 0.389 },
        { "x": 0.403, "y": 0.390 }
      ]
    }
  ]
}
```

---

## BUILD ORDER

1. **Setup Environment**
   - Install Node.js
   - Run `npm install`

2. **Prepare Data**
   - Clean SVG in Inkscape
   - Run `svg-to-points.js`
   - Optionally convert to binary

3. **Build Core Engine**
   - Test DataLoader
   - Test Timeline
   - Test Renderer

4. **Add Features**
   - WebGL renderer
   - Telemetry
   - Controls

5. **Add Advanced Features**
   - Binary optimization
   - Video export
   - Procedural generation
   - AI integration

6. **Test & Polish**
   - Performance profiling
   - Visual polish
   - Browser compatibility

---

END OF BUILD PLAN
