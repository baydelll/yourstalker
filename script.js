/* ГДЕ ТВОЙ СТАЛКЕР — весь интерактив написан без фреймворков.
 * Код не накладывает SVG-макет на фон. Он управляет настоящими HTML-элементами.
 * Навигация: колесо / тачпад / свайп / стрелки / PageDown.
 * Разрешения камеры и микрофона: только по очереди, без записи и передачи данных.
 */
(() => {
  'use strict';

  const scenes = [...document.querySelectorAll('.scene')];
  const story = document.getElementById('story');
  const audio = document.getElementById('notifyAudio');
  const navPrompt = document.getElementById('navPrompt');
  const soundToggle = document.getElementById('soundToggle');
  const srStatus = document.getElementById('srStatus');
  const progress = document.querySelector('#storyProgress > div');
  let index = 0;
  let active = scenes[0];
  let isTransitioning = false;
  let isMuted = false;
  let audioUnlocked = false;
  let wheelDelta = 0;
  let lastWheelAt = 0;
  let touchStart = null;
  let pending = [];
  let typing = false;
  let scrollToConfirm = 0;
  let sequenceFinished = false;
  const visited = new Set();
  const photoDone = new Set();
  const responseDone = new Set();
  const permissionsAsked = { camera: false, microphone: false };
  const EYE_FRAMES = [...document.querySelectorAll('.eye-frame')];

  function later(callback, ms) {
    const id = setTimeout(callback, ms);
    pending.push(id);
    return id;
  }
  function clearPending() {
    pending.forEach(id => clearTimeout(id));
    pending = [];
  }
  function showPrompt(show = true) { navPrompt.classList.toggle('visible', show && index < scenes.length - 1); }
  function announce(message) { srStatus.textContent = message; }
  function playSound() {
    if (isMuted) return;
    try {
      audio.pause(); audio.currentTime = 0;
      const promise = audio.play();
      if (promise && typeof promise.catch === 'function') promise.catch(() => {
        // Автовоспроизведение может быть заблокировано до первого действия пользователя.
      });
    } catch (_) { /* браузер запретил воспроизведение */ }
  }
  function unlockSound() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    // Разблокировать audio после пользовательского действия, не включая сигнал сейчас.
    if (audio.readyState === 0) audio.load();
  }
  document.addEventListener('pointerdown', unlockSound, {passive:true});
  document.addEventListener('keydown', unlockSound);
  soundToggle.addEventListener('click', () => {
    isMuted = !isMuted;
    soundToggle.setAttribute('aria-pressed', String(!isMuted));
    soundToggle.setAttribute('aria-label', isMuted ? 'Включить звук' : 'Отключить звук');
    soundToggle.innerHTML = isMuted ? '♪ <span>Без звука</span>' : '♫ <span>Звук</span>';
    if (isMuted) audio.pause(); else playSound();
  });

  /* Печатание DOM-текста с сохранением цветных тегов <span>. */
  function typeElement(element, durationPerChar = 29) {
    return new Promise(resolve => {
      if (!element) { resolve(); return; }
      if (element.dataset.fullHtml === undefined) element.dataset.fullHtml = element.innerHTML;
      element.innerHTML = element.dataset.fullHtml;
      element.classList.add('typing');
      element.classList.remove('typed');
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const fragments = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        fragments.push({node, string: node.nodeValue});
        node.nodeValue = '';
      }
      let frag = 0;
      let char = 0;
      const total = fragments.reduce((acc, cur) => acc + cur.string.length, 0);
      const characterDelay = Math.max(15, Math.min(durationPerChar, 10000 / Math.max(total, 1)));
      if (!fragments.length) { element.classList.remove('typing'); resolve(); return; }
      const id = setInterval(() => {
        if (frag >= fragments.length) { clearInterval(id); return; }
        const part = fragments[frag];
        char += 1;
        part.node.nodeValue = part.string.slice(0, char);
        if (char >= part.string.length) { frag++; char = 0; }
        if (frag === fragments.length) {
          clearInterval(id);
          element.classList.remove('typing');element.classList.add('typed');
          resolve();
        }
      }, characterDelay);
      pending.push({interval:id});
    });
  }
  // Обрабатывает и интервалы, и таймеры (при переходе с экрана).
  function cleanTimers() {
    for (const item of pending) {
      if (typeof item === 'object' && item.interval) clearInterval(item.interval);
      else clearTimeout(item);
    }
    pending = [];
  }
  function startTyping(scene, callback) {
    const targets = [...scene.querySelectorAll('.typewrite')];
    if (visited.has(index)) {
      targets.forEach(el => {
        if (el.dataset.fullHtml !== undefined) el.innerHTML = el.dataset.fullHtml;
        el.classList.remove('typing');el.classList.add('typed');
      });
      typing = false;
      if (callback) callback(); else showPrompt(true);
      return;
    }
    typing = targets.length > 0;
    let start = Promise.resolve();
    targets.forEach(el => { start = start.then(() => typeElement(el)); });
    start.then(() => {
      if (active !== scene) return;
      typing = false;
      if (scene.dataset.kind !== 'paired') visited.add(index);
      if (callback) callback(); else showPrompt(true);
    });
  }
  function typeSequence(scene) {
    const output = scene.querySelector('.sequence-text');
    if (!output) {showPrompt(true);return;}
    const phrases = JSON.parse(scene.dataset.sequence);
    if (visited.has(index)) {
      output.textContent = phrases[phrases.length-1];sequenceFinished = true;if (scene.dataset.kind !== 'choice-sequence') showPrompt(true);return;
    }
    sequenceFinished = false;typing = true;
    let phraseIndex = 0, charIndex = 0, deleting = false;
    const cycle = () => {
      if (active !== scene) return;
      const text = phrases[phraseIndex];
      if (!deleting) {
        charIndex++;
        output.textContent = text.slice(0, charIndex);
        output.classList.add('is-typing');
        if (charIndex < text.length) {later(cycle, 49);return;}
        output.classList.remove('is-typing');
        if (phraseIndex === phrases.length-1) {
          typing = false;sequenceFinished = true;visited.add(index);if (scene.dataset.kind !== 'choice-sequence') showPrompt(true);return;
        }
        deleting = true;
        later(cycle, 1700);
      } else {
        charIndex--;
        output.textContent = text.slice(0, charIndex);
        output.classList.add('is-typing');
        if (charIndex > 0) {later(cycle, 20);return;}
        output.classList.remove('is-typing');
        deleting = false;phraseIndex++;
        later(cycle, 430);
      }
    };
    later(cycle, 1200);
  }

  function showNotification(scene) {
    const notification = scene.querySelector('.notification');
    if (!notification) return;
    notification.classList.remove('hidden');
    playSound();
    if (scene.classList.contains('hero')) document.getElementById('heroHint')?.classList.add('shown');
    announce(notification.textContent.trim());
  }
  function revealChatMessage(scene) {
    const messages = [...scene.querySelectorAll('[data-message]')];
    const hidden = messages.find(m => !m.classList.contains('show'));
    if (hidden) {
      hidden.classList.add('show');
      const box = scene.querySelector('.chat-stack');
      // При большом количестве реплик (чат Полины) плавно доводим видимую область до новой реплики.
      later(() => { if(active === scene) box.scrollTo({top:box.scrollHeight,behavior:'smooth'}); }, 90);
      playSound();
      if (!messages.some(m => !m.classList.contains('show'))) {
        const hint = scene.querySelector('.chat-hint');
        if (hint) hint.textContent = scene.dataset.final === 'true' ? 'Ещё один скролл. Ну же.' : 'Ну всё, теперь можешь заблокировать';
        hint?.classList.add('active');
      }
      return true;
    }
    return false;
  }

  function startEyeGlitch() {
    const eyehole = document.getElementById('eyehole');
    const sequence = [0, 1, 0, 2, 0, 1, 2, 0];
    let i = 0;
    function cycle() {
      if (index !== 0) return;
      const state = sequence[i % sequence.length];
      EYE_FRAMES.forEach((e, j) => e.classList.toggle('visible', j === state));
      eyehole.classList.add('flash');
      later(() => eyehole.classList.remove('flash'), 110);
      i++;
      later(cycle, [1350,190,1500,170,1800,220,140,2000][i % 8]);
    }
    later(cycle, 1900);
  }

  function updateStep() {
    story.style.transform = `translate3d(0, calc(-${index} * var(--vh)), 0)`;
    progress.style.width = `${index / Math.max(1,scenes.length-1) * 100}%`;
    document.title = `${index === 0 ? '' : 'Где твой сталкер? · '}${index+1}/${scenes.length}`;
    scenes.forEach((scene, i) => {scene.setAttribute('aria-hidden', i === index ? 'false' : 'true');});
  }

  function enterScene() {
    active = scenes[index];
    typing = false;scrollToConfirm = 0;sequenceFinished = false;
    wheelDelta = 0;
    showPrompt(false);
    const scene = active;
    const kind = scene.dataset.kind;
    if (kind === 'hero') {
      startEyeGlitch();
      later(() => showNotification(scene), 4000);
    } else if (kind === 'chat') {
      if (visited.has(index)) {
        scene.classList.add('restored');
        scene.querySelectorAll('[data-message]').forEach(m => m.classList.add('show'));
        const stack = scene.querySelector('.chat-stack');
        later(() => { if(active === scene) stack.scrollTop = stack.scrollHeight; }, 100);
        scene.querySelector('.chat-hint')?.classList.add('active');
      } else {
        scene.classList.remove('restored');
        scene.dataset.fading = 'false';
        scene.classList.remove('fadeout-chat');
        const stack = scene.querySelector('.chat-stack');
        stack.style.opacity = ''; stack.style.transition = '';stack.scrollTop = 0;
        scene.querySelectorAll('[data-message]').forEach(m => m.classList.remove('show'));
        scene.querySelector('.chat-hint')?.classList.add('active');
      }
    } else if (kind === 'photos') {
      if (photoDone.has(index)) showPrompt(true);
    } else if (kind === 'type') {
      startTyping(scene);
    } else if (kind === 'sequence') {
      typeSequence(scene);
    } else if (kind === 'paired') {
      startTyping(scene, () => later(() => typeSequence(scene), 1300));
    } else if (kind === 'notice') {
      startTyping(scene, () => {
        const delay = Number(scene.querySelector('.notification')?.dataset.notificationDelay || 2800);
        later(() => showNotification(scene), delay);
      });
    } else if (kind === 'choice' || kind === 'choice-sequence') {
      if(responseDone.has(index)) showPrompt(true);
      if(kind === 'choice-sequence') later(() => typeSequence(scene), 1800);
    } else if (kind === 'countdown') {
      startCountdown(scene);
    } else if (kind === 'camera') {
      requestMedia(scene, kind);
      if (scene.dataset.sequence) later(() => { if (active === scene) typeSequence(scene); }, 1800);
      else showPrompt(true);
    } else if (kind === 'microphone') {
      scene.classList.remove('reveal-message');
      later(() => {
        if (active !== scene) return;
        scene.classList.add('reveal-message');
        requestMedia(scene, kind);
        showPrompt(true);
      }, 3100);
    }
    announce(`Экран ${index+1} из ${scenes.length}`);
  }
  function goTo(nextIndex) {
    if (nextIndex < 0 || nextIndex >= scenes.length || isTransitioning) return;
    isTransitioning = true;
    cleanTimers();
    const previous = active;
    if (previous?.dataset.kind === 'chat') visited.add(index);
    index = nextIndex;
    updateStep();
    enterScene();
    setTimeout(() => {isTransitioning = false;}, 720);
  }
  function next() {goTo(index+1);}

  function forward() {
    if (isTransitioning) return;
    const kind = active.dataset.kind;
    if (kind === 'microphone' && !active.classList.contains('reveal-message')) return;
    if (kind === 'camera' && active.dataset.sequence && !sequenceFinished) return;
    if (kind === 'hero' || kind === 'notice') return; // Только через плашку сообщения.
    if (kind === 'photos') {
      if (photoDone.has(index)) next();
      return;
    }
    if (kind === 'chat') {
      if (revealChatMessage(active)) return;
      if (active.dataset.final === 'true') {
        if (active.dataset.fading === 'true') return;
        active.dataset.fading = 'true';
        active.classList.add('fadeout-chat');
        active.querySelector('.chat-stack').style.opacity='0';
        active.querySelector('.chat-stack').style.transition='opacity .8s';
        later(next, 840); // Плюс один скролл, после последнего сообщения.
      }
      return;
    }
    if (kind === 'choice' || kind === 'choice-sequence') {
      if (responseDone.has(index)) next();
      return;
    }
    if (kind === 'countdown') {
      if (active.dataset.ended === 'true') next();
      return;
    }
    if ((kind === 'sequence' || kind === 'paired') && !sequenceFinished) return;
    if (typing) return;
    if (kind === 'type' || kind === 'sequence' || kind === 'paired') {
      if (scrollToConfirm++ === 0) {showPrompt(true);return;}
    }
    next();
  }
  function backwards() {
    if (isTransitioning || index === 0) return;
    goTo(index-1);
  }

  function startCountdown(scene) {
    const count = scene.querySelector('[data-clock]');
    const total = Number(scene.dataset.seconds || 15);
    let remaining = total;
    scene.dataset.ended = 'false';
    count.textContent = String(remaining);
    const tick = () => {
      if (active !== scene) return;
      remaining -= 1;
      count.textContent = String(Math.max(0, remaining));
      if (remaining > 0) later(tick, 1000);
      else {
        scene.dataset.ended = 'true';
        if (scene.classList.contains('final-choice')) {
          const confirmation = scene.querySelector('.choice-confirm');
          if (!confirmation.classList.contains('show')) {confirmation.textContent = 'Время вышло.';confirmation.classList.add('show');}
          later(next, 1550);
        } else {showPrompt(true);later(next, 1250);}
      }
    };
    later(tick, 1000);
  }

  // Разрешение появляется только штатным диалогом браузера.
  // Записи и передачи данных нет: полученные потоки сразу останавливаются.
  async function requestMedia(scene, kind) {
    if (permissionsAsked[kind]) return;
    permissionsAsked[kind] = true;
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: kind === 'camera',
        audio: kind === 'microphone'
      });
      stream.getTracks().forEach(track => track.stop());
    } catch (_) {
      // Браузер может отказать: дополнительных надписей и кнопок на экране нет.
    }
  }

  document.getElementById('returnTop')?.addEventListener('click', () => {
    // Перезапуск интерактивной истории, включая сообщения, таймеры и глитч.
    window.location.reload();
  });
  document.querySelectorAll('[data-notification-target]').forEach(button => {
    button.addEventListener('click', () => {unlockSound();if (active.contains(button)) next();});
  });
  document.querySelectorAll('[data-block]').forEach(button => {
    button.addEventListener('click', () => {
      if (active !== button.closest('.scene')) return;
      if (button.dataset.block === 'broken') {
        // Последняя кнопка намеренно не работает: так устроена история.
        button.classList.remove('shiver');void button.offsetWidth;button.classList.add('shiver');
        return;
      }
      visited.add(index);
      next();
    });
  });
  document.querySelectorAll('.photo-scene').forEach(scene => {
    const correct = scene.dataset.correct.split(',').map(Number);
    const selected = new Set();
    const feedback = scene.querySelector('.photo-feedback');
    scene.querySelectorAll('[data-photo]').forEach(button => {
      button.addEventListener('click', () => {
        if (active !== scene || photoDone.has(index)) return;
        const answer = Number(button.dataset.photo);
        if (correct.includes(answer)) {
          button.classList.add('selected','correct');selected.add(answer);
          if (selected.size === correct.length) {
            feedback.textContent = 'Верно.';
            photoDone.add(index);
            announce('Правильный ответ. Переход к следующему экрану.');
            later(next, 920);
          } else feedback.textContent = `Правильно. Найди ещё ${correct.length-selected.size}.`;
        } else {
          button.classList.add('wrong');
          feedback.textContent = 'Присмотрись. Ищи чёрную подозрительную фигуру.';
          later(() => {button.classList.remove('wrong');}, 700);
        }
      });
    });
  });
  document.querySelectorAll('[data-choice]').forEach(button => {
    button.addEventListener('click', () => {
      const scene = button.closest('.scene');
      if (active !== scene) return;
      const confirm = scene.querySelector('.choice-confirm');
      if (!confirm.classList.contains('show')) {
        confirm.textContent = 'Точно?';confirm.classList.add('show');
        button.classList.add('selected-button');
      } else {
        responseDone.add(index);
        confirm.textContent = '…';
        later(next, 720);
      }
    });
  });
  document.querySelectorAll('[data-final-choice]').forEach(button => {
    button.addEventListener('click', () => {
      if (active !== button.closest('.scene')) return;
      const confirm = active.querySelector('.choice-confirm');
      confirm.textContent = 'Ты думаешь, от этого что-то зависит?';
      confirm.classList.add('show');
      active.dataset.ended = 'true';
      later(next, 900);
    });
  });

  window.addEventListener('wheel', event => {
    if (event.ctrlKey) return;
    event.preventDefault();
    const now = performance.now();
    if (now - lastWheelAt > 310) wheelDelta = 0;
    lastWheelAt = now;
    wheelDelta += event.deltaY;
    if (Math.abs(wheelDelta) < 35) return;
    const dir = Math.sign(wheelDelta);wheelDelta = 0;
    if (dir > 0) forward(); else backwards();
  }, {passive:false});
  window.addEventListener('touchstart', event => {
    touchStart = {y:event.touches[0]?.clientY || 0,time:performance.now()};
  }, {passive:true});
  window.addEventListener('touchend', event => {
    if (!touchStart) return;
    const dy = touchStart.y - (event.changedTouches[0]?.clientY || 0);
    touchStart = null;
    if (Math.abs(dy) < 32) return;
    if (dy > 0) forward(); else backwards();
  }, {passive:true});
  document.addEventListener('keydown', event => {
    if (['BUTTON','INPUT','TEXTAREA'].includes(document.activeElement?.tagName)) return;
    if (['ArrowDown','PageDown',' '].includes(event.key)) {event.preventDefault();forward();}
    else if (['ArrowUp','PageUp'].includes(event.key)) {event.preventDefault();backwards();}
  });
  // Визуальная высота сцены следует за браузерным viewport при открытии мобильной адресной строки.
  window.addEventListener('resize', updateStep, {passive:true});
  window.addEventListener('pageshow', updateStep);
  updateStep();
  enterScene();
})();
