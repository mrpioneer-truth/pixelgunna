'use strict';
// 공용 옷장 접근, 구매한 스킨 공유 및 장착.
(function (root) {
  const ZR = (root.ZR = root.ZR || {});
  const $ = (id) => document.getElementById(id);
  const wardrobe = () => ZR.Wardrobe;
  const cards = new Map();
  let entries = [];
  let subscribed = null;
  let request = 0;
  let ready = false;
  let saving = false;

  function status(text) {
    $('wardrobeStatus').textContent = text;
  }

  function showAccessState() {
    const allowed = wardrobe().hasAccess();
    $('wardrobeAccess').classList.toggle('hidden', allowed);
    $('wardrobeContents').classList.toggle('hidden', !allowed);
    return allowed;
  }

  function updateSaveButton() {
    $('wardrobeSave').disabled = !ready || saving || !$('wardrobeSkin').value;
    $('wardrobeSave').textContent = saving ? '저장 중…' : '이름표 저장';
  }

  function fillTag() {
    const entry = entries.find((item) => item.mine && item.skin === $('wardrobeSkin').value);
    $('wardrobeTag').value = entry?.tag || '';
  }

  function renderPurchased() {
    const select = $('wardrobeSkin');
    const previous = select.value;
    const owned = ZR.Economy.getWallet().owned;
    const skins = ZR.Cosmetics.catalog.filter((skin) => skin.price > 0 && owned.includes(skin.id));
    $('wardrobeShare').classList.toggle('hidden', !skins.length);
    $('wardrobeNeedSkin').classList.toggle('hidden', !!skins.length);
    select.replaceChildren(...skins.map((skin) => new Option(skin.name, skin.id)));
    if (skins.some((skin) => skin.id === previous)) select.value = previous;
    if (select.value !== previous) fillTag();
    updateSaveButton();
  }

  function updateWearButtons() {
    const active = wardrobe().getOutfit()?.id;
    for (const [id, { card, button }] of cards) {
      const equipped = id === active;
      card.dataset.equipped = equipped;
      button.textContent = equipped ? '장착 중' : '장착하기';
      button.setAttribute('aria-disabled', equipped);
    }
  }

  function makeCard(entry) {
    const skin = ZR.Cosmetics.get(entry.skin);
    const card = document.createElement('li');
    card.className = 'shopItem';
    card.innerHTML = '<div class="shopArt"><canvas width="168" height="144" aria-hidden="true"></canvas></div>' +
      '<h3></h3><p class="wardrobeNameTag"></p><button type="button"></button>';
    card.querySelector('.shopArt').style.setProperty('--skin-tint', skin.tint);
    ZR.Cosmetics.preview(card.querySelector('canvas'), skin.id);
    card.querySelector('h3').textContent = skin.name;
    card.querySelector('.wardrobeNameTag').textContent = `이름표 · ${entry.tag}`;
    const button = card.querySelector('button');
    button.dataset.entry = entry.id;
    button.setAttribute('aria-label', `${skin.name} (${entry.tag}) 장착`);
    button.onclick = () => {
      if (button.getAttribute('aria-disabled') === 'true') return;
      status(wardrobe().wear(entry) ? `${skin.name} 장착 완료` : '스킨을 장착하지 못했습니다.');
    };
    cards.set(entry.id, { card, button });
    return card;
  }

  function renderEntries() {
    const focused = document.activeElement?.dataset.entry;
    cards.clear();
    $('wardrobeItems').replaceChildren(...entries.map(makeCard));
    $('wardrobeEmpty').classList.toggle('hidden', !ready || !!entries.length);
    updateWearButtons();
    cards.get(focused)?.button.focus({ preventScroll: true });
  }

  function stop() {
    request++;
    if (subscribed) subscribed();
    subscribed = null;
  }

  async function connect() {
    stop();
    const id = request;
    const active = () => id === request && $('wardrobe').open;
    const error = (err) => {
      if (!active()) return;
      ready = false;
      updateSaveButton();
      renderEntries();
      $('wardrobeRefresh').classList.remove('hidden');
      status('공용 옷장에 연결하지 못했습니다.');
      ZR.log('공용 옷장 연결 실패', err);
    };
    ready = false;
    entries = [];
    $('wardrobeRefresh').classList.add('hidden');
    status('공유된 스킨을 불러오는 중…');
    renderPurchased();
    renderEntries();
    try {
      const unsubscribe = await wardrobe().subscribe((items) => {
        if (!active()) return;
        const first = !ready;
        ready = true;
        entries = items;
        renderEntries();
        updateSaveButton();
        if (first) {
          if (!$('wardrobeTag').value) fillTag();
          $('wardrobeRefresh').classList.add('hidden');
          status('');
        }
      }, error);
      if (active()) subscribed = unsubscribe;
      else unsubscribe();
    } catch (err) {
      error(err);
    }
  }

  function open() {
    const dialog = $('wardrobe');
    if (dialog.open) return;
    $('wardrobeCode').value = '';
    $('wardrobeTag').value = '';
    status('');
    const allowed = showAccessState();
    dialog.showModal();
    if (allowed) connect();
    else $('wardrobeCode').focus();
  }

  function close() {
    const dialog = $('wardrobe');
    if (!dialog.open) return;
    dialog.close();
    stop();
  }

  function redeem(event) {
    event.preventDefault();
    if (!wardrobe().redeem($('wardrobeCode').value)) {
      status('접근 카드 코드를 확인해 주세요.');
      $('wardrobeCode').focus();
      return;
    }
    if (showAccessState()) {
      connect();
      const focus = $('wardrobeSkin').options.length ? 'wardrobeSkin' : 'wardrobeShareTitle';
      $(focus).focus();
    }
  }

  async function publish(event) {
    event.preventDefault();
    if (!ready || saving) return;
    const id = request;
    saving = true;
    updateSaveButton();
    try {
      const entry = await wardrobe().publish($('wardrobeSkin').value, $('wardrobeTag').value);
      if (id !== request || !$('wardrobe').open) return;
      $('wardrobeTag').value = entry.tag;
      status('이름표를 붙여 공용 옷장에 올렸습니다.');
    } catch (err) {
      if (id === request && $('wardrobe').open) status(err.message || '이름표를 저장하지 못했습니다.');
    } finally {
      saving = false;
      if ($('wardrobe').open) updateSaveButton();
    }
  }

  function onStorage(event) {
    if (!$('wardrobe').open) return;
    if (event.key === null || event.key === 'zr.wardrobe.access') {
      const wasAllowed = !$('wardrobeContents').classList.contains('hidden');
      const allowed = showAccessState();
      if (allowed && !wasAllowed) connect();
      if (!allowed && wasAllowed) {
        stop();
        status('');
      }
    }
    if (event.key === null || event.key === 'zr.wallet.v1') renderPurchased();
    if (event.key === null || event.key === 'zr.wardrobe.outfit') updateWearButtons();
  }

  function init() {
    $('btnWardrobe').onclick = open;
    $('wardrobe').addEventListener('close', () => {
      if (!$('wardrobe').open) stop();
    });
    $('wardrobeAccess').onsubmit = redeem;
    $('wardrobeShare').onsubmit = publish;
    $('wardrobeRefresh').onclick = connect;
    $('wardrobeSkin').onchange = fillTag;
    root.addEventListener('zr.wardrobechange', updateWearButtons);
    root.addEventListener('zr.walletchange', () => {
      if ($('wardrobe').open) renderPurchased();
    });
    root.addEventListener('storage', onStorage);
  }

  ZR.WardrobeUI = Object.freeze({ init, open, close });
})(typeof window !== 'undefined' ? window : globalThis);
