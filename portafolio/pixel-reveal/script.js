document.addEventListener('DOMContentLoaded', function () {
  const animationStepDuration = 0.3;
  const gridSize = 7;
  const pixelSize = 100 / gridSize;
  const cards = document.querySelectorAll('[data-pixelated-image-reveal]');
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches;

  cards.forEach((card) => {
    const pixelGrid = card.querySelector('[data-pixelated-image-reveal-grid]');
    const activeCard = card.querySelector('[data-pixelated-image-reveal-active]');
    const existingPixels = pixelGrid.querySelectorAll('.pixelated-image-card__pixel');

    existingPixels.forEach(pixel => pixel.remove());

    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        const pixel = document.createElement('div');
        pixel.classList.add('pixelated-image-card__pixel');
        pixel.style.width = `${pixelSize}%`;
        pixel.style.height = `${pixelSize}%`;
        pixel.style.left = `${col * pixelSize}%`;
        pixel.style.top = `${row * pixelSize}%`;
        pixelGrid.appendChild(pixel);
      }
    }

    const pixels = pixelGrid.querySelectorAll('.pixelated-image-card__pixel');
    const totalPixels = pixels.length;
    const staggerDuration = animationStepDuration / totalPixels;
    let isActive = false;
    let delayedCall;

    const animatePixels = (activate) => {
      isActive = activate;
      gsap.killTweensOf(pixels);
      if (delayedCall) delayedCall.kill();

      gsap.set(pixels, { display: 'none' });

      gsap.to(pixels, {
        display: 'block',
        duration: 0,
        stagger: {
          each: staggerDuration,
          from: 'random'
        }
      });

      delayedCall = gsap.delayedCall(animationStepDuration, () => {
        if (activate) {
          activeCard.style.display = 'block';
          activeCard.style.pointerEvents = 'none';
        } else {
          activeCard.style.display = 'none';
        }
      });

      gsap.to(pixels, {
        display: 'none',
        duration: 0,
        delay: animationStepDuration,
        stagger: {
          each: staggerDuration,
          from: 'random'
        }
      });
    };

    if (isTouchDevice) {
      card.addEventListener('click', () => {
        animatePixels(!isActive);
      });
    } else {
      card.addEventListener('mouseenter', () => {
        if (!isActive) animatePixels(true);
      });

      card.addEventListener('mouseleave', () => {
        if (isActive) animatePixels(false);
      });
    }
  });
});
