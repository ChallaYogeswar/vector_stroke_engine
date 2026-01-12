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
