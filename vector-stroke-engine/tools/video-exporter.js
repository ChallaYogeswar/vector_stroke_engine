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
