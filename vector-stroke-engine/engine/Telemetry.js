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
