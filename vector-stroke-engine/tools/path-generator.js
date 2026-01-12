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
