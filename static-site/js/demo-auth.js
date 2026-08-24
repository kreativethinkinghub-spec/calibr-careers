(function(){
  var KEY = 'calibr_demo_auth';
  var HASH = 'af4eec27';
  var EMAIL = 'karlit@kth-tech.com';

  function simpleHash(s) {
    for (var h = 0, i = 0; i < s.length; i++)
      h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16).slice(0, 8);
  }

  if (sessionStorage.getItem(KEY) === HASH) return;

  document.body.style.overflow = 'hidden';

  var overlay = document.createElement('div');
  overlay.id = 'demo-gate';
  overlay.innerHTML =
    '<div style="position:fixed;inset:0;z-index:9999;background:#050505;display:flex;align-items:center;justify-content:center">' +
      '<div style="text-align:center;max-width:380px;padding:32px">' +
        '<div style="width:56px;height:56px;border-radius:16px;background:linear-gradient(135deg,#FF1B8D,#A855F7);display:flex;align-items:center;justify-content:center;margin:0 auto 24px;font-size:24px;font-weight:900;color:white">C</div>' +
        '<h2 style="font-family:Poppins,Arial,sans-serif;font-size:22px;font-weight:800;color:white;margin:0 0 8px">Demo Access</h2>' +
        '<p style="font-size:13px;color:#FFFFFF;margin:0 0 24px;line-height:1.5">This demo is private. Enter your credentials to continue.</p>' +
        '<input id="demo-email" type="email" placeholder="Email address" autocomplete="email" style="width:100%;padding:14px 16px;border-radius:12px;border:1.5px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:white;font-size:14px;font-family:Poppins,Arial,sans-serif;outline:none;box-sizing:border-box;margin-bottom:12px">' +
        '<input id="demo-pw" type="password" placeholder="Access code" autocomplete="current-password" style="width:100%;padding:14px 16px;border-radius:12px;border:1.5px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:white;font-size:14px;font-family:Poppins,Arial,sans-serif;outline:none;box-sizing:border-box;margin-bottom:12px">' +
        '<button id="demo-submit" style="width:100%;padding:14px;border-radius:12px;border:none;background:linear-gradient(135deg,#FF1B8D,#A855F7);color:white;font-size:14px;font-weight:700;font-family:Poppins,Arial,sans-serif;cursor:pointer;box-shadow:0 4px 20px rgba(255,27,141,0.3)">Enter Demo</button>' +
        '<p id="demo-err" style="font-size:12px;color:#EF4444;margin:12px 0 0;display:none">Incorrect email or access code</p>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  var emailInput = document.getElementById('demo-email');
  var pwInput = document.getElementById('demo-pw');
  var btn = document.getElementById('demo-submit');
  var err = document.getElementById('demo-err');

  function resetErr() {
    err.style.display = 'none';
    emailInput.style.borderColor = 'rgba(255,255,255,0.1)';
    pwInput.style.borderColor = 'rgba(255,255,255,0.1)';
  }

  function tryAuth() {
    var email = emailInput.value.trim().toLowerCase();
    var pw = pwInput.value;
    if (email === EMAIL && simpleHash(pw) === HASH) {
      sessionStorage.setItem(KEY, HASH);
      overlay.remove();
      document.body.style.overflow = '';
    } else {
      err.style.display = 'block';
      emailInput.style.borderColor = '#EF4444';
      pwInput.style.borderColor = '#EF4444';
      pwInput.value = '';
      pwInput.focus();
    }
  }

  btn.onclick = tryAuth;
  pwInput.onkeydown = function(e) { if (e.key === 'Enter') tryAuth(); };
  emailInput.onkeydown = function(e) { if (e.key === 'Enter') pwInput.focus(); };
  emailInput.onfocus = resetErr;
  pwInput.onfocus = resetErr;
  emailInput.focus();
})();
