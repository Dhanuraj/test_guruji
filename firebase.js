// ── Globals ──
window.FBDB = null;
window.FBAUTH = null;
window.googleProvider = null;
window.CURRENT_USER = null;
window.FB_READY = false;

// ── Helpers (global) ──
function userRef(key){ return FBDB.ref('swarpro/users/'+CURRENT_USER.uid+'/'+key); }

function fbSet(key, data){
  // Update localStorage immediately for instant local UI response
  localStorage.setItem(key, JSON.stringify(data));
  try{
    if(CURRENT_USER && FBDB){
      // Firebase removes empty arrays — store null so listener knows to clear
      const val=(Array.isArray(data)&&data.length===0)?null:data;
      userRef(key).set(val).catch(e=>console.warn('FB write:',e));
    }
  }catch(e){ console.warn('FB write:',e); }
}
function fbSetRaw(key, val){
  localStorage.setItem(key, val);
  try{
    if(CURRENT_USER && FBDB) userRef(key).set(val).catch(e=>console.warn('FB write:',e));
  }catch(e){}
}

// ── Real-time listener reference (so we can detach on sign out) ──
let _realtimeRef = null;

function loadFromFirebase(callback){
  if(!CURRENT_USER||!FBDB){ FB_READY=true; callback(); return; }

  const ARRAY_KEYS=['sp_students','sp_payments','sp_classes','sp_hw','sp_prog','sp_batches'];
  const ALL_KEYS=[...ARRAY_KEYS,'sp_settings','sp_avail','sp_theme'];

  const ref = FBDB.ref('swarpro/users/'+CURRENT_USER.uid);
  _realtimeRef = ref;
  let firstLoad = true;

  ref.on('value', snap=>{
    const data = snap.val();

    // ── ALWAYS update localStorage from Firebase (single source of truth) ──
    ALL_KEYS.forEach(k=>{
      if(!data){
        // No data in Firebase at all — clear arrays, keep settings
        if(ARRAY_KEYS.includes(k)) localStorage.setItem(k,'[]');
        return;
      }
      const v = data[k];
      if(v != null){
        // Firebase has data — overwrite localStorage completely
        localStorage.setItem(k, typeof v==='string' ? v : JSON.stringify(v));
      } else {
        // null = empty array stored (Firebase removes empty nodes)
        if(ARRAY_KEYS.includes(k)) localStorage.setItem(k,'[]');
        else if(k!=='sp_settings') localStorage.removeItem(k);
      }
    });

    if(firstLoad){
      firstLoad = false;
      FB_READY = true;
      callback();
    } else {
      // Data changed on another device — refresh current page
      console.log('🔄 Syncing from Firebase...');
      refreshUI();
      // Flash sync dot yellow → green
      const dot=document.getElementById('fbDot');
      if(dot){
        dot.style.background='#f59e0b';
        dot.title='Syncing...';
        setTimeout(()=>{dot.style.background='#34d399';dot.title='Firebase synced';},1500);
      }
    }
  }, e=>{
    console.warn('FB listener error:',e);
    if(firstLoad){ firstLoad=false; FB_READY=true; callback(); }
  });
}

// Detach listener on sign out
function detachRealtimeListener(){
  if(_realtimeRef){ _realtimeRef.off(); _realtimeRef=null; }
}

// Refresh whichever page is currently visible
function refreshUI(){
  try{
    const pg=document.querySelector('.pg.on');
    if(!pg) return;
    const id=pg.id;
    if(id==='pg-dash')        renderDash();
    else if(id==='pg-stu')    renderStu();
    else if(id==='pg-batch')  renderBatches();
    else if(id==='pg-sch')    renderSchContent();
    else if(id==='pg-rep')    renderRep();
    else if(id==='pg-alerts') renderAlerts();
    else if(id==='pg-set')    renderSettings();
    else if(id==='pg-det'&&window.detId) renderDet(window.detId);
    if(typeof updateBell==='function') updateBell();
  }catch(e){ console.warn('refreshUI:',e); }
}

function signInEmail(){
  if(!FBAUTH){showAuthError('Still connecting… please wait');return;}
  const email=(document.getElementById('authEmail').value||'').trim();
  const pass=document.getElementById('authPass').value||'';
  if(!email||!pass){showAuthError('Enter email and password');return;}
  setAuthLoading(true);
  FBAUTH.signInWithEmailAndPassword(email,pass).catch(e=>{
    if(e.code==='auth/user-not-found'||e.code==='auth/invalid-credential'){
      FBAUTH.createUserWithEmailAndPassword(email,pass)
        .catch(err=>{showAuthError(friendlyAuthError(err));setAuthLoading(false);});
    } else {showAuthError(friendlyAuthError(e));setAuthLoading(false);}
  });
}

function signInGoogle(){
  if(!FBAUTH||!googleProvider){showAuthError('Still connecting… please wait');return;}
  setAuthLoading(true);
  // Use redirect instead of popup — works on file://, mobile, and all browsers
  FBAUTH.signInWithRedirect(googleProvider)
    .catch(e=>{showAuthError(friendlyAuthError(e));setAuthLoading(false);});
}

function signOut(){
  if(!FBAUTH) return;
  detachRealtimeListener();
  FBAUTH.signOut().then(()=>{ CURRENT_USER=null; localStorage.clear(); location.reload(); });
}

function friendlyAuthError(e){
  const map={
    'auth/wrong-password':'Wrong password.',
    'auth/invalid-email':'Invalid email address.',
    'auth/email-already-in-use':'Email already registered — try signing in.',
    'auth/weak-password':'Password must be at least 6 characters.',
    'auth/user-not-found':'No account found.',
    'auth/invalid-credential':'Wrong email or password.',
    'auth/popup-closed-by-user':'Google sign-in cancelled.',
    'auth/network-request-failed':'No internet connection.',
  };
  return map[e.code]||e.message||'Something went wrong.';
}
function showAuthError(msg){
  const el=document.getElementById('authError');
  if(el){el.textContent=msg;el.style.display='block';}
}
function setAuthLoading(v){
  const b=document.getElementById('authSubmitBtn');
  const g=document.getElementById('googleBtn');
  if(b){b.disabled=v;b.textContent=v?'Please wait…':'Sign In / Register';}
  if(g) g.disabled=v;
}
function forgotPassword(){
  if(!FBAUTH){showAuthError('Still connecting… please wait');return;}
  const email=(document.getElementById('authEmail').value||'').trim();
  if(!email){showAuthError('Enter your email first');return;}
  FBAUTH.sendPasswordResetEmail(email)
    .then(()=>{
      const el=document.getElementById('authError');
      if(el){el.textContent='✅ Reset link sent to '+email;el.style.display='block';
        el.style.background='#0a2a10';el.style.borderColor='var(--grn)';el.style.color='var(--grn)';}
    }).catch(e=>showAuthError(friendlyAuthError(e)));
}

// ── Enable buttons helper ──
function enableAuthButtons(){
  const sb=document.getElementById('authSubmitBtn');
  const gb=document.getElementById('googleBtn');
  if(sb){sb.disabled=false;sb.textContent='Sign In / Register';sb.style.opacity='1';}
  if(gb){gb.disabled=false;gb.style.opacity='1';}
}

// ── Firebase init (called once SDK is ready) ──
let fbInitAttempts=0;
function initFirebase(){
  fbInitAttempts++;
  if(typeof firebase==='undefined'){
    if(fbInitAttempts>50){ // 5 seconds max waiting
      console.warn('Firebase SDK failed to load — showing login anyway');
      enableAuthButtons();
      document.getElementById('fbLoadingOv').style.display='none';
      document.getElementById('loginScreen').style.display='flex';
      return;
    }
    setTimeout(initFirebase,100); return;
  }
  const cfg={
    apiKey:"AIzaSyDq0wU2b5YXwTxioyulhYuHt-oC_JVk7-4",
    authDomain:"guruji-efd1c.firebaseapp.com",
    databaseURL:"https://guruji-efd1c-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId:"guruji-efd1c",
    storageBucket:"guruji-efd1c.firebasestorage.app",
    messagingSenderId:"655258391567",
    appId:"1:655258391567:web:cc371f3f4fe7df6897bf7a"
  };
  if(!firebase.apps.length) firebase.initializeApp(cfg);
  window.FBDB = firebase.database();
  window.FBAUTH = firebase.auth();
  window.googleProvider = new firebase.auth.GoogleAuthProvider();

  // Enable login buttons now that Firebase is ready
  enableAuthButtons();

  // Auth state — single entry point to app
  FBAUTH.onAuthStateChanged(user=>{
    if(user){
      CURRENT_USER=user;
      document.getElementById('loginScreen').style.display='none';
      document.getElementById('app').style.display=window.innerWidth>=768?'grid':'flex';
      document.getElementById('fbLoadingOv').style.display='flex';
      const uphoto=document.getElementById('userPhoto');
      const uavatar=document.getElementById('userAvatarFallback');
      if(uphoto){uphoto.src=user.photoURL||'';uphoto.style.display=user.photoURL?'block':'none';}
      if(uavatar) uavatar.style.display=user.photoURL?'none':'flex';
      loadFromFirebase(()=>{
        document.getElementById('fbLoadingOv').style.display='none';
        if(typeof bootApp==='function') bootApp();
      });
    } else {
      CURRENT_USER=null;
      document.getElementById('loginScreen').style.display='flex';
      document.getElementById('app').style.display='none';
      document.getElementById('fbLoadingOv').style.display='none';
    }
  });

  // Handle Google redirect result (for file:// environments)
  FBAUTH.getRedirectResult().then(result=>{
    if(result&&result.user) console.log('Redirect sign-in success');
  }).catch(e=>{ if(e.code!=='auth/no-current-user') console.warn('Redirect result:',e); });
}

// ── Boot ──
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded', initFirebase);
} else {
  initFirebase();
}

// Safety net — show login if stuck after 5s
setTimeout(()=>{
  const ov=document.getElementById('fbLoadingOv');
  const ls=document.getElementById('loginScreen');
  const app=document.getElementById('app');
  if(ov&&ov.style.display!=='none'){
    ov.style.display='none';
    if(ls&&ls.style.display==='none'&&app&&app.style.display==='none'){
      ls.style.display='flex';
      enableAuthButtons();
    }
  }
},5000);
