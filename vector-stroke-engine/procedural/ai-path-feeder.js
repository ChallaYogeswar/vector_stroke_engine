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
