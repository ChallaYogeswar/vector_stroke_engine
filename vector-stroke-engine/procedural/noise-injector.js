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
