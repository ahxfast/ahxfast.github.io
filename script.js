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


function updateCountdown() {
    var now = new Date();
    var eventDate = new Date(2023, 11, 15, 18, 0, 0); // December is 11 in JavaScript (0-indexed)
    var currentTime = now.getTime();
    var eventTime = eventDate.getTime();
    var remTime = eventTime - currentTime;

    var s = Math.floor(remTime / 1000);
    var m = Math.floor(s / 60);
    var h = Math.floor(m / 60);
    var d = Math.floor(h / 24);

    h %= 24;
    m %= 60;
    s %= 60;

    h = (h < 10) ? "0" + h : h;
    m = (m < 10) ? "0" + m : m;
    s = (s < 10) ? "0" + s : s;

    document.getElementById("days").textContent = d;
    document.getElementById("hours").textContent = h;
    document.getElementById("minutes").textContent = m;
    document.getElementById("seconds").textContent = s;

    setTimeout(updateCountdown, 1000);
}

updateCountdown();