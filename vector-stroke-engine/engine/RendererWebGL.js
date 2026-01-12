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
        const result = /^#?([a-f\d]{2})(a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
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
