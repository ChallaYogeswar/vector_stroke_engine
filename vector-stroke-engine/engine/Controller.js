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
