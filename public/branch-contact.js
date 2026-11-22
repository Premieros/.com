(() => {
  'use strict';
  const script = document.currentScript;
  const branch = script?.dataset.branch;
  if (!branch || !/^[a-f0-9-]{36}$/i.test(branch)) return;
  const premier = new URL(script.src).origin;
  const support = document.createElement('a');
  support.href = premier + '/#/customer-support/' + branch;
  support.target = '_blank';
  support.rel = 'noopener noreferrer';
  support.textContent = 'الشكاوى والاستفسارات';
  support.dir = 'rtl';
  support.style.cssText = 'position:fixed;bottom:22px;left:18px;z-index:900;padding:12px 18px;border-radius:24px;background:#231e19;color:#fff;text-decoration:none;font:bold 14px system-ui;box-shadow:0 3px 16px #0004';
  document.body.append(support);

  const area = document.querySelector('[data-premier-social-links]');
  if (!area) return;
  const networks = {facebook:['f','Facebook'], instagram:['◎','Instagram'], whatsapp:['◉','WhatsApp'], tiktok:['♪','TikTok'], website:['↗','Website']};
  fetch('https://hvqlkapynjfjikqithvd.supabase.co/rest/v1/rpc/branch_contact_links', {
    method:'POST',
    headers:{apikey:'sb_publishable_9W6651rcdIsyBoegwGe_qw_MvCPRIPK','Content-Type':'application/json'},
    body:JSON.stringify({p_branch:branch}),
  }).then(response => response.ok ? response.json() : null).then(links => {
    if (!links) return;
    for (const [key,[icon,label]] of Object.entries(networks)) {
      if (!links[key]) continue;
      try {
        const url = new URL(links[key]);
        if (url.protocol !== 'https:' || url.username || url.password) continue;
        const link = document.createElement('a');
        link.href=url.href; link.target='_blank'; link.rel='noopener noreferrer';
        link.setAttribute('aria-label',label); link.title=label; link.dataset.network=key;
        link.textContent=area.id==='bunkerSocial' ? label : icon;
        if (area.id!=='bunkerSocial') link.style.cssText='display:inline-grid;place-items:center;width:38px;height:38px;border:1px solid currentColor;border-radius:50%;margin:3px;text-decoration:none';
        area.append(link);
      } catch { /* Invalid URLs stay hidden. */ }
    }
  }).catch(() => {});
})();
