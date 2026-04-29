(() => {
  const header = document.querySelector('[data-nav]');
  const burger = document.querySelector('[data-burger]');
  const menu = document.querySelector('[data-menu]');
  const reveals = document.querySelectorAll('.reveal');
  const counters = document.querySelectorAll('[data-counter]');
  const tiltCards = document.querySelectorAll('[data-tilt]');
  const timerBadge = document.querySelector('[data-timer-seconds]');
  const timerForm = document.querySelector('[data-timer-form]');
  const cursorRing = document.querySelector('.cursor-ring');
  const cursorDot = document.querySelector('.cursor-dot');

  if (burger && menu) {
    burger.addEventListener('click', () => {
      const open = menu.classList.toggle('is-open');
      document.body.classList.toggle('menu-open', open);
    });
  }

  const onScroll = () => {
    if (header) header.classList.toggle('is-scrolled', window.scrollY > 18);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  if (reveals.length) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    reveals.forEach((item, index) => {
      item.style.transitionDelay = `${Math.min(index * 40, 280)}ms`;
      observer.observe(item);
    });
  }

  const animateCounter = (el) => {
    const target = Number(el.dataset.counter || 0);
    const duration = 1200;
    const start = performance.now();
    const tick = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(target * eased).toLocaleString();
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  if (counters.length) {
    const counterObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && !entry.target.dataset.played) {
          entry.target.dataset.played = '1';
          animateCounter(entry.target);
        }
      });
    }, { threshold: 0.4 });
    counters.forEach((counter) => counterObserver.observe(counter));
  }

  tiltCards.forEach((card) => {
    card.addEventListener('mousemove', (event) => {
      const rect = card.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width;
      const py = (event.clientY - rect.top) / rect.height;
      const rx = (py - 0.5) * -8;
      const ry = (px - 0.5) * 10;
      card.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-4px)`;
    });
    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
    });
  });

  if (timerBadge && timerForm) {
    let remaining = Number(timerBadge.dataset.timerSeconds || 0);
    const render = () => {
      const mins = String(Math.floor(remaining / 60)).padStart(2, '0');
      const secs = String(remaining % 60).padStart(2, '0');
      timerBadge.textContent = `${mins}:${secs}`;
    };
    render();
    const interval = window.setInterval(() => {
      remaining -= 1;
      render();
      if (remaining <= 0) {
        clearInterval(interval);
        timerForm.submit();
      }
    }, 1000);
  }

  if (cursorRing && cursorDot && window.matchMedia('(pointer:fine)').matches) {
    let mx = window.innerWidth / 2;
    let my = window.innerHeight / 2;
    let rx = mx;
    let ry = my;
    let dx = mx;
    let dy = my;

    window.addEventListener('mousemove', (event) => {
      mx = event.clientX;
      my = event.clientY;
    }, { passive: true });

    const loop = () => {
      rx += (mx - rx) * 0.16;
      ry += (my - ry) * 0.16;
      dx += (mx - dx) * 0.28;
      dy += (my - dy) * 0.28;
      cursorRing.style.transform = `translate(${rx}px, ${ry}px) translate(-50%, -50%)`;
      cursorDot.style.transform = `translate(${dx}px, ${dy}px) translate(-50%, -50%)`;
      requestAnimationFrame(loop);
    };
    loop();

    document.querySelectorAll('a, button, input, select, textarea, label').forEach((el) => {
      el.addEventListener('mouseenter', () => {
        cursorRing.style.width = '52px';
        cursorRing.style.height = '52px';
      });
      el.addEventListener('mouseleave', () => {
        cursorRing.style.width = '36px';
        cursorRing.style.height = '36px';
      });
    });
  }

  // Custom select dropdowns
  document.querySelectorAll('.custom-select-wrapper').forEach((wrapper) => {
    const trigger = wrapper.querySelector('.custom-select-trigger');
    const options = wrapper.querySelectorAll('.custom-select-option');
    const label = wrapper.querySelector('.custom-select-label');
    const input = wrapper.querySelector('.custom-select-value');

    trigger.addEventListener('click', () => {
      wrapper.classList.toggle('is-open');
    });

    options.forEach((option) => {
      option.addEventListener('click', () => {
        input.value = option.dataset.value;
        label.textContent = option.textContent;
        options.forEach(o => o.classList.remove('is-selected'));
        option.classList.add('is-selected');
        wrapper.classList.remove('is-open');
      });
    });

    document.addEventListener('click', (e) => {
      if (!wrapper.contains(e.target)) wrapper.classList.remove('is-open');
    });
  });

})();