document.addEventListener('DOMContentLoaded', function () {
    const container = document.querySelector('.bubble-container');
    for (let i = 0; i < 100; i++) {
        let bubble = document.createElement('div');
        bubble.classList.add('bubble');
        bubble.style.left = `${Math.random() * 100}%`;
        bubble.style.top = `${Math.random() * 100}%`;
        bubble.style.width = `${Math.random() * 150 + 20}px`;
        bubble.style.height = bubble.style.width;
        bubble.style.backgroundColor = `rgba(${Math.random() * 255}, ${Math.random() * 255}, ${Math.random() * 255}, ${Math.random()})`;
        bubble.style.animationDuration = `${Math.random() * 10 + 5}s`;
        container.appendChild(bubble);
    }
});
