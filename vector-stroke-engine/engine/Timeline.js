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
