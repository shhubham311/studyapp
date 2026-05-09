// ═══════════════════════════════════════════════════════
//  StudyTrack — Complete JavaScript
//  Supabase Auth + DB · Pomodoro · Ambient Sounds
//  Command Palette · Focus Mode · Keyboard Shortcuts
//  + Offline / localStorage Mode
// ═══════════════════════════════════════════════════════

// ── Supabase Config ────────────────────────────
const SUPABASE_URL = 'https://gimzumqhongsksvvjqnr.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdpbXp1bXFob25nc2tzdnZqcW5yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyMzM4NDgsImV4cCI6MjA5MzgwOTg0OH0.I1MMkElg2ahLi8NQffBf0Du7qjIzzhDAEiilXc2mfOA';

let sb;
try { sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON); } catch(e) {
  console.error('Supabase init failed:', e);
}

// ── State ──────────────────────────────────────
let CU = null, UP = null;
let isOffline = false;
let clockInTime = null, clockInLabel = '';
let goalDate = todayStr(), sessDate = todayStr(), noteDate = todayStr();
let calYear, calMonth, calSelDate;
let statPeriod = 'weekly';
let chartTime = null, chartGoals = null;
let selectedMood = 'Good';
let dbReady = false;

// Pomodoro
let pomoMode = 'focus'; // focus | short | long
let pomoRunning = false;
let pomoSecondsLeft = 25 * 60;
let pomoTotalSeconds = 25 * 60;
let pomoInterval = null;
let pomoCount = 0; // completed focus sessions
let pomoFocusStart = null; // timestamp when focus started for auto-logging

// Settings
let settings = { focusMin: 25, shortMin: 5, longMin: 15 };

// Ambient Sounds
let audioCtx = null;
let ambientNodes = {};
let ambientActive = null;
let ambientVolume = 0.4;

// Command Palette
let cmdItems = [];
let cmdSelectedIdx = 0;

// ── localStorage Helpers ───────────────────────
function lsGet(key) { try { return JSON.parse(localStorage.getItem('st-'+key)) || null } catch(e) { return null } }
function lsSet(key, val) { localStorage.setItem('st-'+key, JSON.stringify(val)) }
function lsGetArr(key) { return lsGet(key) || [] }

// ── Helpers ────────────────────────────────────
function todayStr(){const d=new Date();return `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`}
function p2(n){return String(n).padStart(2,'0')}
function dateShift(str,n){const d=new Date(str+'T12:00:00');d.setDate(d.getDate()+n);return `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`}
function fmtDur(m){if(m<1)return'0m';const h=Math.floor(m/60),mn=Math.floor(m%60);return h?`${h}h ${mn}m`:`${mn}m`}
function fmtTime(ts){if(!ts)return'';const d=new Date(ts);return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}
function fmtRelative(ts){if(!ts)return'';const diff=Math.floor((Date.now()-new Date(ts).getTime())/1000);if(diff<60)return'just now';if(diff<3600)return`${Math.floor(diff/60)}m ago`;if(diff<86400)return`${Math.floor(diff/3600)}h ago`;return new Date(ts).toLocaleDateString()}
function fmtDayName(str){const[y,m,d]=str.split('-').map(Number);return new Date(y,m-1,d).toLocaleDateString([],{weekday:'long'})}
function avatarBg(uid){const c=['#6366f1','#8b5cf6','#3b82f6','#22c55e','#f59e0b','#ef4444','#06b6d4','#ec4899'];return c[(uid||'').split('').reduce((a,c)=>a+c.charCodeAt(0),0)%c.length]}
function initials(name){return(name||'?').charAt(0).toUpperCase()}
function uid(){return CU?CU.id:null}
function $(id){return document.getElementById(id)}

function toast(msg,type='ok'){
  const el=document.createElement('div');el.className=`toast ${type}`;
  const icon=type==='ok'?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
  el.innerHTML=`${icon}<span>${msg}</span>`;
  $('toast-wrap').appendChild(el);setTimeout(()=>el.remove(),3500);
}

function showPage(id){document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));$(id).classList.add('active')}

function showView(id){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  $('view-'+id).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view===id));
  document.querySelectorAll('.mob-nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view===id));
  if(id==='calendar')renderCalendar();
  if(id==='stats')renderStats();
  if(id==='leaderboard')renderLeaderboard();
  if(id==='community')renderCommunity();
}

function openModal(id){$(id).classList.add('open')}
function closeModal(id){$(id).classList.remove('open')}

// ── Theme ──────────────────────────────────────
function toggleTheme(){
  const html=document.documentElement;
  const isDark=html.getAttribute('data-theme')==='dark';
  html.setAttribute('data-theme',isDark?'light':'dark');
  localStorage.setItem('st-theme',isDark?'light':'dark');
  // Update charts if they exist
  if(chartTime||chartGoals)renderStats();
}
function initTheme(){
  const saved=localStorage.getItem('st-theme');
  if(saved)document.documentElement.setAttribute('data-theme',saved);
  else document.documentElement.setAttribute('data-theme','dark');
}

// ── Database Setup ─────────────────────────────
async function checkDatabase(){
  if(isOffline){dbReady=true;$('setup-banner').style.display='none';return}
  try{const{error}=await sb.from('profiles').select('id').limit(1);if(error&&error.code==='PGRST205'){dbReady=false;$('setup-banner').style.display='block';}else{dbReady=true;$('setup-banner').style.display='none';}}catch(e){dbReady=false;$('setup-banner').style.display='block';}
}

async function setupDatabase(){
  const SQL=`
CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, display_name TEXT, username TEXT UNIQUE, email TEXT, current_streak INT DEFAULT 0, longest_streak INT DEFAULT 0, last_streak_date TEXT DEFAULT '', total_study_minutes INT DEFAULT 0, today_study_minutes INT DEFAULT 0, week_study_minutes INT DEFAULT 0, month_study_minutes INT DEFAULT 0, total_goals_completed INT DEFAULT 0, total_goals_added INT DEFAULT 0, last_active_date TEXT DEFAULT '', active_session JSONB, created_at TIMESTAMPTZ DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username) WHERE username IS NOT NULL;
CREATE TABLE IF NOT EXISTS goals (id TEXT PRIMARY KEY, user_id TEXT REFERENCES profiles(id) ON DELETE CASCADE, date TEXT NOT NULL, text TEXT NOT NULL, completed BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT REFERENCES profiles(id) ON DELETE CASCADE, date TEXT NOT NULL, clock_in TIMESTAMPTZ, clock_out TIMESTAMPTZ, duration_minutes INT DEFAULT 0, label TEXT DEFAULT 'Study session', created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, user_id TEXT REFERENCES profiles(id) ON DELETE CASCADE, date TEXT NOT NULL, content TEXT NOT NULL, mood TEXT DEFAULT 'Good', created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, user_id TEXT REFERENCES profiles(id) ON DELETE CASCADE, title TEXT NOT NULL, date TEXT NOT NULL, time TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS activity (id TEXT PRIMARY KEY, user_id TEXT, display_name TEXT, username TEXT, type TEXT, detail TEXT, created_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY; ALTER TABLE goals ENABLE ROW LEVEL SECURITY; ALTER TABLE sessions ENABLE ROW LEVEL SECURITY; ALTER TABLE notes ENABLE ROW LEVEL SECURITY; ALTER TABLE events ENABLE ROW LEVEL SECURITY; ALTER TABLE activity ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
CREATE POLICY "profiles_all" ON profiles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "goals_all" ON goals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "sessions_all" ON sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "notes_all" ON notes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "events_all" ON events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "activity_all" ON activity FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS idx_goals_user_date ON goals(user_id, date);
CREATE INDEX IF NOT EXISTS idx_sessions_user_date ON sessions(user_id, date);
CREATE INDEX IF NOT EXISTS idx_notes_user_date ON notes(user_id, date);
CREATE INDEX IF NOT EXISTS idx_events_user_date ON events(user_id, date);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity(created_at DESC);
`;
  toast('Downloading SQL setup file...');
  const sqlBlob=new Blob([SQL],{type:'text/plain'});const url=URL.createObjectURL(sqlBlob);
  const a=document.createElement('a');a.href=url;a.download='supabase_setup.sql';a.click();URL.revokeObjectURL(url);
  window.open('https://supabase.com/dashboard/project/gimzumqhongsksvvjqnr/sql/new','_blank');
}

// ── Auth ───────────────────────────────────────
function switchTab(tab){document.querySelectorAll('.auth-tab').forEach((t,i)=>t.classList.toggle('active',(i===0&&tab==='login')||(i===1&&tab==='register')));$('form-login').style.display=tab==='login'?'block':'none';$('form-register').style.display=tab==='register'?'block':'none';$('auth-err').classList.remove('show')}
function showErr(m){const e=$('auth-err');e.textContent=m;e.classList.add('show')}

async function loginEmail(){
  const em=$('l-email').value.trim(),ps=$('l-pass').value;
  if(!em||!ps){showErr('Fill in all fields');return}
  $('l-btn').disabled=true;
  const{data,error}=await sb.auth.signInWithPassword({email:em,password:ps});
  $('l-btn').disabled=false;
  if(error){showErr(error.message);return}
  CU={id:data.user.id,displayName:data.user.user_metadata?.display_name||data.user.email,email:data.user.email};
  showPage('page-app');loadApp();
}

async function registerEmail(){
  const nm=$('r-name').value.trim(),un=$('r-username').value.trim().replace(/[^a-zA-Z0-9_]/g,''),em=$('r-email').value.trim(),ps=$('r-pass').value;
  if(!nm||!em||!ps){showErr('Fill in all fields');return}
  if(ps.length<6){showErr('Password must be at least 6 characters');return}
  if(un&&un.length<3){showErr('Username must be at least 3 characters');return}
  if(un){const{data:existing}=await sb.from('profiles').select('id').eq('username',un).limit(1);if(existing&&existing.length>0){showErr('Username is already taken');return}}
  $('r-btn').disabled=true;
  const{data,error}=await sb.auth.signUp({email:em,password:ps,options:{data:{display_name:nm}}});
  $('r-btn').disabled=false;
  if(error){showErr(error.message);return}
  const userId=data.user?.id||data.session?.user?.id;
  if(userId){
    const profileData={id:userId,display_name:nm,email:em};if(un)profileData.username=un;
    await sb.from('profiles').insert(profileData);
    CU={id:userId,displayName:nm,email:em};showPage('page-app');loadApp();toast('Account created! Welcome '+nm);
  }else{showErr('Check your email to confirm your account, then sign in.')}
}

async function loginDemo(){
  const demoEmail='demo@studytrack.com',demoPass='demo123456';
  try{
    let{data,error}=await sb.auth.signInWithPassword({email:demoEmail,password:demoPass});
    if(error){
      // Account doesn't exist, create it
      const{data:signupData,error:signupErr}=await sb.auth.signUp({email:demoEmail,password:demoPass,options:{data:{display_name:'Demo User'}}});
      if(signupErr){toast('Could not create demo account: '+signupErr.message,'err');return}
      const userId=signupData?.user?.id;
      if(!userId){toast('Failed to create demo account','err');return}
      // Wait for session to establish
      await new Promise(r=>setTimeout(r,1000));
      // Create profile
      const{error:profileErr}=await sb.from('profiles').insert({id:userId,display_name:'Demo User',email:demoEmail,username:'demo',current_streak:2,longest_streak:2,last_streak_date:todayStr(),total_study_minutes:195,today_study_minutes:90,week_study_minutes:195,month_study_minutes:195,total_goals_completed:3,total_goals_added:5,last_active_date:todayStr()});
      if(profileErr&&!profileErr.message.includes('duplicate')){console.error('Profile error:',profileErr)}
      const today=todayStr(),yesterday=dateShift(today,-1);
      // Use unique IDs to avoid conflicts
      const timestamp=Date.now();
      await sb.from('goals').insert([{id:'g1_'+timestamp,user_id:userId,date:today,text:'Complete Chapter 5 exercises',completed:true},{id:'g2_'+timestamp,user_id:userId,date:today,text:'Review lecture notes',completed:false},{id:'g3_'+timestamp,user_id:userId,date:today,text:'Practice coding problems',completed:false}]);
      await sb.from('sessions').insert([{id:'s1_'+timestamp,user_id:userId,date:today,clock_in:new Date(today+'T09:00:00').toISOString(),clock_out:new Date(today+'T10:30:00').toISOString(),duration_minutes:90,label:'Morning Study'},{id:'s2_'+timestamp,user_id:userId,date:yesterday,clock_in:new Date(yesterday+'T14:00:00').toISOString(),clock_out:new Date(yesterday+'T15:45:00').toISOString(),duration_minutes:105,label:'Afternoon Review'}]);
      await sb.from('events').insert([{id:'e1_'+timestamp,user_id:userId,title:'Study Group',date:today,time:'15:00'},{id:'e2_'+timestamp,user_id:userId,title:'Exam Prep',date:dateShift(today,2),time:'10:00'}]);
      await sb.from('notes').insert([{id:'n1_'+timestamp,user_id:userId,date:today,content:'Reviewed key concepts from Chapter 5. Need to focus more on differential equations.',mood:'Good',created_at:new Date(today+'T10:30:00').toISOString()}]);
      await sb.from('activity').insert([{id:'a1_'+timestamp,user_id:userId,display_name:'Demo User',username:'demo',type:'clockin',detail:'Clocked in',created_at:new Date(today+'T09:00:00').toISOString()},{id:'a2_'+timestamp,user_id:userId,display_name:'Demo User',username:'demo',type:'clockout',detail:'Clocked out after 1h 30m',created_at:new Date(today+'T10:30:00').toISOString()}]);
      // Now sign in
      const{data:loginData,error:loginErr}=await sb.auth.signInWithPassword({email:demoEmail,password:demoPass});
      if(loginErr){toast('Account created but login failed: '+loginErr.message,'err');return}
      CU={id:loginData.user.id,displayName:'Demo User',email:demoEmail};showPage('page-app');loadApp();toast('Welcome, Demo User!');
    }else{
      CU={id:data.user.id,displayName:data.user.user_metadata?.display_name||'Demo User',email:data.user.email};showPage('page-app');loadApp();toast('Welcome back!');
    }
  }catch(e){
    console.error('Demo login error:',e);
    toast('An error occurred: '+e.message,'err');
  }
}

function loginOffline(){
  isOffline = true;
  CU = {id: 'local_user', displayName: 'Local User', email: ''};
  localStorage.setItem('st-offline', 'true');
  // Load or create profile from localStorage
  let profile = lsGet('profile');
  if(!profile){
    profile = {id:'local_user',display_name:'Local User',email:'',username:null,current_streak:0,longest_streak:0,last_streak_date:'',total_study_minutes:0,today_study_minutes:0,week_study_minutes:0,month_study_minutes:0,total_goals_completed:0,total_goals_added:0,last_active_date:'',active_session:null};
    lsSet('profile', profile);
  }
  showPage('page-app');
  loadApp();
  toast('Welcome! Running in Local Mode');
}

async function logout(){
  if(clockInTime){if(!confirm('You are clocked in. Clock out and sign out?'))return;await clockOut();}
  if(isOffline){
    isOffline = false;
    localStorage.removeItem('st-offline');
    CU=null;UP=null;
    showPage('page-auth');stopPomo();stopAllAmbient();
    return;
  }
  await sb.auth.signOut();CU=null;UP=null;showPage('page-auth');stopPomo();stopAllAmbient();
}

if(sb) sb.auth.onAuthStateChange(async(event,session)=>{
  // Don't auto-login offline users from Supabase sessions
  if(isOffline)return;
  if(session?.user){CU={id:session.user.id,displayName:session.user.user_metadata?.display_name||session.user.email,email:session.user.email};showPage('page-app');loadApp();}
  else if(!CU){showPage('page-auth');}
});

// ── Load App ───────────────────────────────────
async function loadApp(){
  if(isOffline){
    // Offline: load from localStorage, skip checkDatabase
    $('setup-banner').style.display='none';
    UP = lsGet('profile') || {id:uid(),display_name:CU.displayName,email:CU.email,username:null,current_streak:0,longest_streak:0,last_streak_date:'',total_study_minutes:0,today_study_minutes:0,week_study_minutes:0,month_study_minutes:0,total_goals_completed:0,total_goals_added:0,last_active_date:'',active_session:null};
    lsSet('profile', UP);
    if(UP.active_session?.clockIn){clockInTime=new Date(UP.active_session.clockIn).getTime();clockInLabel=UP.active_session.label||'';}
    loadSettings();setGreeting();updateClockUI();updateDashStats();
    updateGoalsDateUI();updateSessDateUI();updateNotesDateUI();
    const n=new Date();calYear=n.getFullYear();calMonth=n.getMonth();calSelDate=todayStr();
    $('event-date').value=todayStr();
    renderDashGoals();renderActivity();renderSessList();renderNotesList();renderPomoTally();
    buildCommandItems();
    return;
  }
  await checkDatabase();
  const{data}=await sb.from('profiles').select('*').eq('id',uid()).single();
  UP=data||{id:uid(),display_name:CU.displayName,email:CU.email,username:null,current_streak:0,longest_streak:0,last_streak_date:'',total_study_minutes:0,today_study_minutes:0,week_study_minutes:0,month_study_minutes:0,total_goals_completed:0,total_goals_added:0,last_active_date:'',active_session:null};
  if(!data){await sb.from('profiles').insert({id:uid(),display_name:CU.displayName,email:CU.email,username:null});}
  if(UP.active_session?.clockIn){clockInTime=new Date(UP.active_session.clockIn).getTime();clockInLabel=UP.active_session.label||'';}
  loadSettings();setGreeting();updateClockUI();updateDashStats();
  updateGoalsDateUI();updateSessDateUI();updateNotesDateUI();
  const n=new Date();calYear=n.getFullYear();calMonth=n.getMonth();calSelDate=todayStr();
  $('event-date').value=todayStr();
  renderDashGoals();renderActivity();renderSessList();renderNotesList();renderPomoTally();
  buildCommandItems();
}

function setGreeting(){
  const h=new Date().getHours();const g=h<12?'Good morning':h<17?'Good afternoon':'Good evening';
  $('d-greeting').textContent=`${g}, ${CU.displayName?.split(' ')[0]||'there'}`;
  $('d-date').textContent=new Date().toLocaleDateString([],{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  $('sb-name').textContent=CU.displayName||'User';
  const un=UP?.username;if(un)$('sb-username').textContent='@'+un;else $('sb-username').textContent='Set a username';
  const av=$('sb-avatar');av.style.background=avatarBg(CU.id);av.textContent=initials(CU.displayName);
  const mobAv=$('mob-profile-btn');if(mobAv){mobAv.style.background=avatarBg(CU.id);mobAv.textContent=initials(CU.displayName);}
  // Offline badge
  if(isOffline){$('sb-offline-badge').style.display='inline-flex';}else{$('sb-offline-badge').style.display='none';}
}

function openProfileModal(){
  $('profile-name').value=CU.displayName||'';
  $('profile-username').value=UP?.username||'';
  $('profile-email').value=CU.email||'';
  $('profile-current-pass').value='';$('profile-new-pass').value='';$('profile-confirm-pass').value='';
  $('profile-err').style.display='none';
  // Offline: hide email and password fields
  if(isOffline){
    const emailGroup=$('profile-email');if(emailGroup)emailGroup.closest('.form-group').style.display='none';
    const unGroup=$('profile-username');if(unGroup)unGroup.closest('.form-group').style.display='none';
    const passFields=document.querySelectorAll('#modal-profile .pass-field, #modal-profile [id^="profile-"][id$="pass"]');
    passFields.forEach(f=>{const grp=f.closest('.form-group');if(grp)grp.style.display='none';});
  }else{
    const emailGroup=$('profile-email');if(emailGroup)emailGroup.closest('.form-group').style.display='';
    const unGroup=$('profile-username');if(unGroup)unGroup.closest('.form-group').style.display='';
    const passFields=document.querySelectorAll('#modal-profile .pass-field, #modal-profile [id^="profile-"][id$="pass"]');
    passFields.forEach(f=>{const grp=f.closest('.form-group');if(grp)grp.style.display='';});
  }
  openModal('modal-profile');
}

async function saveProfile(){
  const errEl=$('profile-err');errEl.style.display='none';
  const newName=$('profile-name').value.trim();

  if(isOffline){
    if(!newName){errEl.textContent='Display name is required.';errEl.style.display='block';return}
    CU.displayName=newName;
    if(UP){UP.display_name=newName;}
    lsSet('profile',UP);
    setGreeting();closeModal('modal-profile');toast('Profile updated');
    return;
  }

  const newUsername=$('profile-username').value.trim().replace(/[^a-zA-Z0-9_]/g,'');
  const currentPass=$('profile-current-pass').value;
  const newPass=$('profile-new-pass').value;
  const confirmPass=$('profile-confirm-pass').value;
  if(!newName){errEl.textContent='Display name is required.';errEl.style.display='block';return}
  if(newUsername&&newUsername.length<3){errEl.textContent='Username must be at least 3 characters.';errEl.style.display='block';return}
  if(newUsername&&newUsername!==(UP?.username||'')){const{data:existing}=await sb.from('profiles').select('id').eq('username',newUsername).limit(1);if(existing&&existing.length>0){errEl.textContent='Username is already taken.';errEl.style.display='block';return}}
  if(currentPass||newPass||confirmPass){
    if(!currentPass){errEl.textContent='Enter your current password to change it.';errEl.style.display='block';return}
    if(newPass.length<6){errEl.textContent='New password must be at least 6 characters.';errEl.style.display='block';return}
    if(newPass!==confirmPass){errEl.textContent='New passwords do not match.';errEl.style.display='block';return}
    const{error:reAuthErr}=await sb.auth.signInWithPassword({email:CU.email,password:currentPass});
    if(reAuthErr){errEl.textContent='Current password is incorrect.';errEl.style.display='block';return}
    const{error:passErr}=await sb.auth.updateUser({password:newPass});
    if(passErr){errEl.textContent='Password update failed: '+passErr.message;errEl.style.display='block';return}
  }
  const updates={display_name:newName};if(newUsername)updates.username=newUsername;else updates.username=null;
  await sb.from('profiles').update(updates).eq('id',uid());
  await sb.auth.updateUser({data:{display_name:newName}});
  CU.displayName=newName;if(UP){UP.display_name=newName;UP.username=newUsername||null;}
  setGreeting();closeModal('modal-profile');toast('Profile updated');
}

function updateDashStats(){
  if(!UP)return;
  $('d-streak-badge').textContent=`${UP.current_streak||0} day streak`;
  let todayMin=UP.today_study_minutes||0;if(clockInTime)todayMin+=Math.floor((Date.now()-clockInTime)/60000);
  $('d-today-val').textContent=fmtDur(todayMin);
  $('d-week-val').textContent=fmtDur(UP.week_study_minutes||0);
  const rate=UP.total_goals_added>0?Math.round((UP.total_goals_completed/UP.total_goals_added)*100):0;
  $('d-rate-val').textContent=`${rate}%`;
}

// ── Clock In/Out ───────────────────────────────
let clockTimerInt = null;
function updateClockUI(){
  const label=$('d-clock-label'),title=$('d-clock-title'),timer=$('d-timer'),btn=$('d-clock-btn');
  if(clockInTime){
    label.textContent='CURRENTLY STUDYING';title.textContent=clockInLabel||'Study session';timer.style.display='block';
    clearInterval(clockTimerInt);
    clockTimerInt=setInterval(()=>{
      const el=Math.max(0,Date.now()-clockInTime);const h=Math.floor(el/3600000),m=Math.floor((el%3600000)/60000),s=Math.floor((el%60000)/1000);
      timer.textContent=`${p2(h)}:${p2(m)}:${p2(s)}`;
    },1000);
    btn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Clock Out';
    btn.classList.add('btn-clock-out');
  }else{
    label.textContent='READY TO FOCUS?';title.textContent='Start your session';timer.style.display='none';
    clearInterval(clockTimerInt);timer.textContent='00:00:00';
    btn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg> Clock In';
    btn.classList.remove('btn-clock-out');
  }
}

async function toggleClockDash(){if(clockInTime)await clockOut();else await clockIn()}

async function clockIn(){
  clockInLabel=$('sess-label').value.trim()||'Study session';clockInTime=Date.now();
  const today=todayStr();const updates={active_session:{clockIn:new Date(clockInTime).toISOString(),label:clockInLabel},last_active_date:today};
  if(UP.last_active_date!==today)updates.today_study_minutes=0;

  if(isOffline){
    Object.assign(UP,updates);lsSet('profile',UP);
    const activityArr=lsGetArr('activity');
    activityArr.unshift({id:'act_'+Date.now(),user_id:uid(),display_name:CU.displayName,username:UP?.username||null,type:'clockin',detail:'Clocked in',created_at:new Date().toISOString()});
    lsSet('activity',activityArr);
    updateClockUI();renderActivity();toast('Clocked in! Focus up');
    return;
  }

  await sb.from('profiles').update(updates).eq('id',uid());
  await sb.from('activity').insert({id:'act_'+Date.now(),user_id:uid(),display_name:CU.displayName,username:UP?.username||null,type:'clockin',detail:'Clocked in'});
  updateClockUI();renderActivity();toast('Clocked in! Focus up');
}

async function clockOut(){
  if(!clockInTime)return;const clockOutTime=Date.now();const dur=Math.max(1,Math.floor((clockOutTime-clockInTime)/60000));
  const today=todayStr(),yest=dateShift(today,-1);
  let streak=1;if(UP.last_streak_date===yest||UP.last_streak_date===today){streak=UP.last_streak_date===today?UP.current_streak:(UP.current_streak||0)+1}
  const longest=Math.max(streak,UP.longest_streak||0);
  const updates={active_session:null,today_study_minutes:(UP.today_study_minutes||0)+dur,total_study_minutes:(UP.total_study_minutes||0)+dur,week_study_minutes:(UP.week_study_minutes||0)+dur,month_study_minutes:(UP.month_study_minutes||0)+dur,current_streak:streak,longest_streak:longest,last_streak_date:today,last_active_date:today};

  if(isOffline){
    Object.assign(UP,updates);lsSet('profile',UP);
    const sessArr=lsGetArr('sessions');
    sessArr.push({id:'sess_'+Date.now(),user_id:uid(),date:today,clock_in:new Date(clockInTime).toISOString(),clock_out:new Date(clockOutTime).toISOString(),duration_minutes:dur,label:clockInLabel||'Study session'});
    lsSet('sessions',sessArr);
    const activityArr=lsGetArr('activity');
    activityArr.unshift({id:'act_'+Date.now(),user_id:uid(),display_name:CU.displayName,username:UP?.username||null,type:'clockout',detail:`Clocked out after ${fmtDur(dur)}`,created_at:new Date().toISOString()});
    lsSet('activity',activityArr);
    $('sess-label').value='';clockInTime=null;clockInLabel='';
    updateClockUI();updateDashStats();renderSessList();renderActivity();toast(`Session saved: ${fmtDur(dur)}`);
    return;
  }

  await sb.from('profiles').update(updates).eq('id',uid());Object.assign(UP,updates);
  await sb.from('sessions').insert({id:'sess_'+Date.now(),user_id:uid(),date:today,clock_in:new Date(clockInTime).toISOString(),clock_out:new Date(clockOutTime).toISOString(),duration_minutes:dur,label:clockInLabel||'Study session'});
  await sb.from('activity').insert({id:'act_'+Date.now(),user_id:uid(),display_name:CU.displayName,username:UP?.username||null,type:'clockout',detail:`Clocked out after ${fmtDur(dur)}`});
  $('sess-label').value='';clockInTime=null;clockInLabel='';
  updateClockUI();updateDashStats();renderSessList();renderActivity();toast(`Session saved: ${fmtDur(dur)}`);
}

// ── Activity ───────────────────────────────────
async function renderActivity(){
  let data;
  if(isOffline){
    data=lsGetArr('activity').sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,10);
  }else{
    const result=await sb.from('activity').select('*').order('created_at',{ascending:false}).limit(10);
    data=result.data||[];
  }
  const el=$('d-activity-list');if(!data||!data.length){el.innerHTML='<div class="goal-empty">No activity yet</div>';return}
  const iconMap={clockin:'clockin',clockout:'clockout',note:'note',goal:'goal'};
  const svgMap={clockin:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5,3 19,12 5,21"/></svg>',clockout:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>',note:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/></svg>',goal:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>'};
  el.innerHTML=data.map(a=>{const isMe=a.user_id===uid();const showName=isMe?(a.display_name||'User'):(a.username?'@'+a.username:(a.display_name||'User'));return `<div class="activity-item"><div class="activity-icon ${iconMap[a.type]||'note'}">${svgMap[a.type]||''}</div><div class="activity-text"><div><strong>${showName}</strong> <span>${a.detail||''}</span></div><div class="activity-time">${fmtRelative(a.created_at)}</div></div></div>`}).join('');
}

// ── Goals ──────────────────────────────────────
function updateGoalsDateUI(){
  const d=goalDate,today=todayStr();const ms=['January','February','March','April','May','June','July','August','September','October','November','December'];const dl=d.split('-');
  $('goals-date-label').textContent=fmtDayName(d);$('goals-date-sub').textContent=`${ms[parseInt(dl[1])-1]} ${parseInt(dl[2])}, ${dl[0]}`;
  $('goals-today-btn').style.display=d===today?'none':'block';renderGoalsPage();
}
function goalDateNav(n){goalDate=dateShift(goalDate,n);updateGoalsDateUI()}
function goalGoToday(){goalDate=todayStr();updateGoalsDateUI()}

async function renderDashGoals(){
  let items;
  if(isOffline){
    items=lsGetArr('goals').filter(g=>g.user_id===uid()&&g.date===todayStr());
  }else{
    const{data}=await sb.from('goals').select('*').eq('user_id',uid()).eq('date',todayStr());
    items=data||[];
  }
  const el=$('d-goal-list');const done=items.filter(g=>g.completed).length;
  $('d-goals-val').textContent=`${done}/${items.length}`;$('d-goals-sub').textContent=items.length?`${done} completed`:'No goals yet';
  if(!items.length){el.innerHTML='<div class="goal-empty">No goals for today. <a href="#" onclick="showView(\'goals\');return false">Add one</a></div>';return}
  el.innerHTML=items.slice(0,5).map(g=>`<div class="goal-mini"><button class="goal-check-btn ${g.completed?'done':''}" onclick="toggleGoal('${g.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></button><div class="goal-mini-text ${g.completed?'done':''}">${g.text}</div></div>`).join('');
}

async function renderGoalsPage(){
  let items;
  if(isOffline){
    items=lsGetArr('goals').filter(g=>g.user_id===uid()&&g.date===goalDate);
  }else{
    const{data}=await sb.from('goals').select('*').eq('user_id',uid()).eq('date',goalDate);
    items=data||[];
  }
  const el=$('goals-list-wrap');
  if(!items.length){el.innerHTML='<div class="goals-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>No goals for this day<br/><small style="color:var(--text3)">Add your first goal to get started</small></div>';return}
  el.innerHTML=`<div class="goal-list">${items.map(g=>`<div class="goal-card ${g.completed?'done':''}"><div class="check-circle ${g.completed?'done':''}" onclick="toggleGoal('${g.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div><div class="goal-card-text ${g.completed?'done':''}">${g.text}</div><div class="goal-card-actions"><button class="goal-action-btn" onclick="deleteGoal('${g.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button></div></div>`).join('')}</div>`;
}

async function addGoal(){
  const text=$('goal-text').value.trim();if(!text){toast('Enter a goal','err');return}

  if(isOffline){
    const goalsArr=lsGetArr('goals');
    goalsArr.push({id:'g_'+Date.now(),user_id:uid(),date:goalDate,text,completed:false});
    lsSet('goals',goalsArr);
    UP.total_goals_added=(UP.total_goals_added||0)+1;
    lsSet('profile',UP);
    const activityArr=lsGetArr('activity');
    activityArr.unshift({id:'act_'+Date.now(),user_id:uid(),display_name:CU.displayName,username:UP?.username||null,type:'goal',detail:`Added: ${text.slice(0,30)}`,created_at:new Date().toISOString()});
    lsSet('activity',activityArr);
    $('goal-text').value='';closeModal('modal-goal');renderGoalsPage();renderDashGoals();updateDashStats();renderActivity();toast('Goal added');
    return;
  }

  await sb.from('goals').insert({id:'g_'+Date.now(),user_id:uid(),date:goalDate,text,completed:false});
  await sb.from('profiles').update({total_goals_added:(UP.total_goals_added||0)+1}).eq('id',uid());UP.total_goals_added=(UP.total_goals_added||0)+1;
  await sb.from('activity').insert({id:'act_'+Date.now(),user_id:uid(),display_name:CU.displayName,username:UP?.username||null,type:'goal',detail:`Added: ${text.slice(0,30)}`});
  $('goal-text').value='';closeModal('modal-goal');renderGoalsPage();renderDashGoals();updateDashStats();renderActivity();toast('Goal added');
}

async function toggleGoal(id){
  if(isOffline){
    const goalsArr=lsGetArr('goals');
    const goal=goalsArr.find(g=>g.id===id);if(!goal)return;
    const wasCompleted=goal.completed;
    goal.completed=!wasCompleted;
    lsSet('goals',goalsArr);
    if(!wasCompleted){
      UP.total_goals_completed=(UP.total_goals_completed||0)+1;
      lsSet('profile',UP);
      const activityArr=lsGetArr('activity');
      activityArr.unshift({id:'act_'+Date.now(),user_id:uid(),display_name:CU.displayName,username:UP?.username||null,type:'goal',detail:`Completed: ${goal.text.slice(0,30)}`,created_at:new Date().toISOString()});
      lsSet('activity',activityArr);
    }else{
      UP.total_goals_completed=Math.max(0,(UP.total_goals_completed||0)-1);
      lsSet('profile',UP);
    }
    renderGoalsPage();renderDashGoals();updateDashStats();renderActivity();
    return;
  }

  const{data}=await sb.from('goals').select('*').eq('id',id).single();if(!data)return;
  const wasCompleted=data.completed;await sb.from('goals').update({completed:!wasCompleted}).eq('id',id);
  if(!wasCompleted){UP.total_goals_completed=(UP.total_goals_completed||0)+1;await sb.from('profiles').update({total_goals_completed:UP.total_goals_completed}).eq('id',uid());await sb.from('activity').insert({id:'act_'+Date.now(),user_id:uid(),display_name:CU.displayName,username:UP?.username||null,type:'goal',detail:`Completed: ${data.text.slice(0,30)}`});}
  else{UP.total_goals_completed=Math.max(0,(UP.total_goals_completed||0)-1);await sb.from('profiles').update({total_goals_completed:UP.total_goals_completed}).eq('id',uid());}
  renderGoalsPage();renderDashGoals();updateDashStats();renderActivity();
}

async function deleteGoal(id){
  if(isOffline){
    let goalsArr=lsGetArr('goals');
    goalsArr=goalsArr.filter(g=>g.id!==id);
    lsSet('goals',goalsArr);
    renderGoalsPage();renderDashGoals();updateDashStats();
    return;
  }
  await sb.from('goals').delete().eq('id',id);renderGoalsPage();renderDashGoals();updateDashStats()
}

// ── Sessions List ──────────────────────────────
function updateSessDateUI(){const d=sessDate,today=todayStr();const ms=['January','February','March','April','May','June','July','August','September','October','November','December'];const dl=d.split('-');$('sess-date-label').textContent=fmtDayName(d);$('sess-date-sub').textContent=`${ms[parseInt(dl[1])-1]} ${parseInt(dl[2])}, ${dl[0]}`;$('sess-today-btn').style.display=d===today?'none':'block';renderSessList()}
function sessDateNav(n){sessDate=dateShift(sessDate,n);updateSessDateUI()}
function sessGoToday(){sessDate=todayStr();updateSessDateUI()}

async function renderSessList(){
  let sessions;
  if(isOffline){
    sessions=lsGetArr('sessions').filter(s=>s.user_id===uid()&&s.date===sessDate).sort((a,b)=>new Date(b.clock_in)-new Date(a.clock_in));
  }else{
    const{data}=await sb.from('sessions').select('*').eq('user_id',uid()).eq('date',sessDate).order('clock_in',{ascending:false});
    sessions=data||[];
  }
  const total=sessions.reduce((a,s)=>a+(s.duration_minutes||0),0);$('sess-total').textContent=fmtDur(total);
  const el=$('sess-list');if(!sessions.length){el.innerHTML='<div class="goal-empty" style="padding:24px 0">No sessions for this day</div>';return}
  el.innerHTML=sessions.map(s=>`<div class="session-item"><div class="session-dot"></div><div class="session-info-left"><div class="session-name">${s.label||'Study session'}</div><div class="session-time">${fmtTime(s.clock_in)} — ${fmtTime(s.clock_out)}</div></div><div class="session-dur">${fmtDur(s.duration_minutes)}</div></div>`).join('');
}

// ── Notes ──────────────────────────────────────
function updateNotesDateUI(){const d=noteDate,today=todayStr();const ms=['January','February','March','April','May','June','July','August','September','October','November','December'];const dl=d.split('-');$('notes-date-label').textContent=fmtDayName(d);$('notes-date-sub').textContent=`${ms[parseInt(dl[1])-1]} ${parseInt(dl[2])}, ${dl[0]}`;$('notes-today-btn').style.display=d===today?'none':'block';renderNotesList()}
function noteDateNav(n){noteDate=dateShift(noteDate,n);updateNotesDateUI()}
function noteGoToday(){noteDate=todayStr();updateNotesDateUI()}

async function renderNotesList(){
  let notes;
  if(isOffline){
    notes=lsGetArr('notes').filter(n=>n.user_id===uid()&&n.date===noteDate).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  }else{
    const{data}=await sb.from('notes').select('*').eq('user_id',uid()).eq('date',noteDate).order('created_at',{ascending:false});
    notes=data||[];
  }
  const el=$('notes-list');
  if(!notes.length){el.innerHTML='<div class="goal-empty" style="padding:40px 0">No notes for this day</div>';return}
  const moodSvg={Good:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/></svg>',Great:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/></svg>',Okay:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="8" y1="15" x2="16" y2="15"/></svg>',Tired:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M16 10s-1.5-1-4-1-4 1-4 1"/></svg>',Stressed:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="8" y1="15" x2="16" y2="15"/></svg>'};
  el.innerHTML=notes.map(n=>`<div class="note-card"><div class="note-card-top"><span class="mood-tag mood-${n.mood||'Good'}">${moodSvg[n.mood]||moodSvg.Good} ${n.mood||'Good'}</span><div class="note-card-actions"><button class="goal-action-btn" style="opacity:1" onclick="deleteNote('${n.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button></div></div><div class="note-card-body">${n.content}</div><div class="note-card-time">${fmtTime(n.created_at)}</div></div>`).join('');
}

function selectMood(btn,mood){document.querySelectorAll('.mood-opt').forEach(b=>b.classList.remove('active'));btn.classList.add('active');selectedMood=mood}

async function addNote(){
  const text=$('note-text').value.trim();if(!text){toast('Write something','err');return}

  if(isOffline){
    const notesArr=lsGetArr('notes');
    notesArr.push({id:'n_'+Date.now(),user_id:uid(),date:noteDate,content:text,mood:selectedMood,created_at:new Date().toISOString()});
    lsSet('notes',notesArr);
    const activityArr=lsGetArr('activity');
    activityArr.unshift({id:'act_'+Date.now(),user_id:uid(),display_name:CU.displayName,username:UP?.username||null,type:'note',detail:'Added a note',created_at:new Date().toISOString()});
    lsSet('activity',activityArr);
    $('note-text').value='';closeModal('modal-note');renderNotesList();renderActivity();toast('Note saved');
    return;
  }

  await sb.from('notes').insert({id:'n_'+Date.now(),user_id:uid(),date:noteDate,content:text,mood:selectedMood});
  await sb.from('activity').insert({id:'act_'+Date.now(),user_id:uid(),display_name:CU.displayName,username:UP?.username||null,type:'note',detail:'Added a note'});
  $('note-text').value='';closeModal('modal-note');renderNotesList();renderActivity();toast('Note saved');
}

async function deleteNote(id){
  if(isOffline){
    let notesArr=lsGetArr('notes');
    notesArr=notesArr.filter(n=>n.id!==id);
    lsSet('notes',notesArr);
    renderNotesList();
    return;
  }
  await sb.from('notes').delete().eq('id',id);renderNotesList()
}

// ── Calendar ───────────────────────────────────
async function renderCalendar(){
  const ms=['January','February','March','April','May','June','July','August','September','October','November','December'];
  $('cal-month-label').textContent=`${ms[calMonth]} ${calYear}`;
  const mStr=`${calYear}-${p2(calMonth+1)}`;

  let events;
  if(isOffline){
    events=lsGetArr('events').filter(e=>e.user_id===uid()&&e.date.startsWith(mStr));
  }else{
    const{data}=await sb.from('events').select('*').eq('user_id',uid()).like('date',mStr+'%');
    events=data||[];
  }

  const calEventsMap={};events.forEach(e=>{(calEventsMap[e.date]=calEventsMap[e.date]||[]).push(e)});
  const firstDay=new Date(calYear,calMonth,1).getDay();const offset=(firstDay+6)%7;
  const daysInMonth=new Date(calYear,calMonth+1,0).getDate();const prevMonthDays=new Date(calYear,calMonth,0).getDate();
  const today=todayStr();let html='';
  for(let i=0;i<offset;i++){html+=`<div class="cal-cell other-month"><span>${prevMonthDays-offset+i+1}</span></div>`}
  for(let d=1;d<=daysInMonth;d++){
    const ds=`${calYear}-${p2(calMonth+1)}-${p2(d)}`;const isToday=ds===today;const isSel=ds===calSelDate;const hasEvt=calEventsMap[ds]?.length>0;
    html+=`<div class="cal-cell ${isToday?'today':''} ${isSel&&!isToday?'selected':''} ${hasEvt?'has-events':''}" onclick="selectCalDay('${ds}')"><span>${d}</span></div>`;
  }
  const totalCells=offset+daysInMonth;const rows=Math.ceil(totalCells/7);const rem=(rows*7)-totalCells;
  for(let d=1;d<=rem;d++){html+=`<div class="cal-cell other-month"><span>${d}</span></div>`}
  $('cal-grid').innerHTML=html;selectCalDay(calSelDate,true);
}
function calNav(n){calMonth+=n;if(calMonth>11){calMonth=0;calYear++}if(calMonth<0){calMonth=11;calYear--}renderCalendar()}
async function selectCalDay(ds,silent=false){
  calSelDate=ds;if(!silent)renderCalendar();
  const ms=['January','February','March','April','May','June','July','August','September','October','November','December'];const[y,m,d]=ds.split('-').map(Number);
  $('cal-sel-label').textContent=`${ms[m-1]} ${d}, ${y}`;$('event-date').value=ds;

  let evts;
  if(isOffline){
    evts=lsGetArr('events').filter(e=>e.user_id===uid()&&e.date===ds);
  }else{
    const{data:events}=await sb.from('events').select('*').eq('user_id',uid()).eq('date',ds);
    evts=events||[];
  }

  const el=$('cal-events-list');
  if(!evts.length){el.innerHTML='<div class="cal-no-events">No events</div>';return}
  el.innerHTML=evts.map(e=>`<div class="event-item"><div class="event-dot"></div><div><div class="event-title">${e.title}</div>${e.time?`<div class="event-time">${e.time}</div>`:''}</div><button class="goal-action-btn" style="opacity:1;margin-left:auto" onclick="deleteEvent('${e.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button></div>`).join('');
}
async function addEvent(){
  const title=$('event-title').value.trim();const date=$('event-date').value;const time=$('event-time').value;
  if(!title||!date){toast('Fill in title and date','err');return}

  if(isOffline){
    const eventsArr=lsGetArr('events');
    eventsArr.push({id:'ev_'+Date.now(),user_id:uid(),title,date,time:time||null});
    lsSet('events',eventsArr);
    $('event-title').value='';$('event-time').value='';closeModal('modal-event');renderCalendar();toast('Event added');
    return;
  }

  await sb.from('events').insert({id:'ev_'+Date.now(),user_id:uid(),title,date,time:time||null});
  $('event-title').value='';$('event-time').value='';closeModal('modal-event');renderCalendar();toast('Event added');
}
async function deleteEvent(id){
  if(isOffline){
    let eventsArr=lsGetArr('events');
    eventsArr=eventsArr.filter(e=>e.id!==id);
    lsSet('events',eventsArr);
    renderCalendar();
    return;
  }
  await sb.from('events').delete().eq('id',id);renderCalendar()
}

// ── Stats ──────────────────────────────────────
function updateStatsUI(){
  if(!UP)return;
  $('st-streak').textContent=`${UP.current_streak||0} days`;$('st-total').textContent=fmtDur(UP.total_study_minutes||0);
  $('st-goals').textContent=UP.total_goals_completed||0;
  const rate=UP.total_goals_added>0?Math.round((UP.total_goals_completed/UP.total_goals_added)*100):0;$('st-rate').textContent=`${rate}%`;
  $('st2-streak').textContent=`${UP.current_streak||0} days`;$('st2-longest').textContent=`${UP.longest_streak||0} days`;
  $('tb-today').textContent=fmtDur(UP.today_study_minutes||0);$('tb-week').textContent=fmtDur(UP.week_study_minutes||0);
  $('tb-month').textContent=fmtDur(UP.month_study_minutes||0);$('tb-all').textContent=fmtDur(UP.total_study_minutes||0);
}
function setPeriod(p,btn){statPeriod=p;document.querySelectorAll('.period-tab').forEach(t=>t.classList.remove('active'));btn.classList.add('active');renderStats()}

async function renderStats(){
  updateStatsUI();renderHeatmap();
  const today=new Date();
  let sessions, allGoals;

  if(isOffline){
    sessions=lsGetArr('sessions').filter(s=>s.user_id===uid());
    allGoals=lsGetArr('goals').filter(g=>g.user_id===uid());
  }else{
    const{data:allSessions}=await sb.from('sessions').select('*').eq('user_id',uid());
    sessions=allSessions||[];
  }

  let labels=[],sessData=[],goalsData=[];
  if(statPeriod==='daily'){
    for(let i=6;i>=0;i--){
      const d=new Date(today);d.setDate(today.getDate()-i);const ds=`${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`;
      labels.push(`${p2(d.getMonth()+1)}-${p2(d.getDate())}`);
      sessData.push(sessions.filter(s=>s.date===ds).reduce((a,s)=>a+(s.duration_minutes||0),0));
      if(isOffline){
        goalsData.push(allGoals.filter(g=>g.date===ds&&g.completed).length);
      }else{
        const{data:g}=await sb.from('goals').select('*').eq('user_id',uid()).eq('date',ds);goalsData.push((g||[]).filter(g2=>g2.completed).length);
      }
    }
  }
  else if(statPeriod==='weekly'){for(let i=6;i>=0;i--){const wEnd=new Date(today);wEnd.setDate(today.getDate()-i*7);const wStart=new Date(wEnd);wStart.setDate(wEnd.getDate()-6);const s=`${wStart.getFullYear()}-${p2(wStart.getMonth()+1)}-${p2(wStart.getDate())}`;const e=`${wEnd.getFullYear()}-${p2(wEnd.getMonth()+1)}-${p2(wEnd.getDate())}`;labels.push(`${p2(wStart.getMonth()+1)}-${p2(wStart.getDate())}`);sessData.push(sessions.filter(s2=>s2.date>=s&&s2.date<=e).reduce((a,s2)=>a+(s2.duration_minutes||0),0));goalsData.push(0)}}
  else{const mn=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];for(let i=5;i>=0;i--){const d=new Date(today.getFullYear(),today.getMonth()-i,1);const mStr=`${d.getFullYear()}-${p2(d.getMonth()+1)}`;labels.push(mn[d.getMonth()]);sessData.push(sessions.filter(s2=>(s2.date||'').startsWith(mStr)).reduce((a,s2)=>a+(s2.duration_minutes||0),0));goalsData.push(0)}}
  const isDark=document.documentElement.getAttribute('data-theme')==='dark';
  const gridColor=isDark?'rgba(255,255,255,0.05)':'rgba(0,0,0,0.06)';
  const tickColor=isDark?'#555':'#aaa';
  const tooltipBg=isDark?'#222':'#fff';const tooltipTitle=isDark?'#fff':'#333';const tooltipBody=isDark?'#aaa':'#666';
  const barColor=isDark?'#818cf8':'#6366f1';
  const chartCfg=(data,lbl)=>({type:'bar',data:{labels,datasets:[{data,backgroundColor:barColor,borderRadius:6,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`${lbl}: ${c.parsed.y}`},backgroundColor:tooltipBg,titleColor:tooltipTitle,bodyColor:tooltipBody,borderColor:gridColor,borderWidth:1}},scales:{x:{grid:{color:gridColor},ticks:{color:tickColor,font:{size:11}}},y:{grid:{color:gridColor},ticks:{color:tickColor,font:{size:11}},beginAtZero:true}}}});
  if(chartTime)chartTime.destroy();chartTime=new Chart($('chart-time').getContext('2d'),chartCfg(sessData,'Minutes'));
  if(chartGoals)chartGoals.destroy();chartGoals=new Chart($('chart-goals').getContext('2d'),chartCfg(goalsData,'Goals'));
}

// ── Activity Heatmap (GitHub-style) ────────────
let heatmapYearOffset = 0;
let heatmapTooltipEl = null;

function heatmapYearNav(dir) {
  heatmapYearOffset += dir;
  // Clamp: can't go more than 1 year into the future
  if (heatmapYearOffset > 0) heatmapYearOffset = 0;
  // Can't go more than 5 years back
  if (heatmapYearOffset < -5) heatmapYearOffset = -5;
  renderHeatmap();
}

async function renderHeatmap(){
  let sessions;
  if(isOffline){
    sessions=lsGetArr('sessions').filter(s=>s.user_id===uid()).map(s=>({date:s.date,duration_minutes:s.duration_minutes}));
  }else{
    const{data}=await sb.from('sessions').select('date,duration_minutes').eq('user_id',uid());
    sessions=data||[];
  }
  const map={};sessions.forEach(s=>{if(s.date&&s.duration_minutes>0)map[s.date]=(map[s.date]||0)+s.duration_minutes});

  const grid=$('heatmap-grid');if(!grid)return;
  const monthsEl=$('heatmap-months');if(!monthsEl)return;
  const yearLabelEl=$('heatmap-year-label');if(!yearLabelEl)return;

  // Calculate the year range to display
  const today = new Date(); today.setHours(0,0,0,0);
  const targetYear = today.getFullYear() + heatmapYearOffset;
  const yearStart = new Date(targetYear, 0, 1); // Jan 1
  const yearEnd = new Date(targetYear, 11, 31); // Dec 31

  // For "current year" mode, show from 1 year ago to today (GitHub default)
  // For past years, show the full year
  let startDate, endDate;
  if (heatmapYearOffset === 0) {
    endDate = today;
    // Go back exactly 365 days (or 366 for leap), then back to the previous Sunday
    const oneYearAgo = new Date(today);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    // Align to Sunday: go back to the Sunday on or before oneYearAgo
    const dayOfWeek = oneYearAgo.getDay(); // 0=Sun
    startDate = new Date(oneYearAgo);
    startDate.setDate(oneYearAgo.getDate() - dayOfWeek);
  } else {
    // Full year view
    startDate = new Date(targetYear, 0, 1);
    endDate = new Date(targetYear, 11, 31);
    // Align startDate to previous Sunday
    const dayOfWeek = startDate.getDay();
    startDate.setDate(startDate.getDate() - dayOfWeek);
    // Extend endDate to next Saturday
    const endDayOfWeek = endDate.getDay();
    endDate.setDate(endDate.getDate() + (6 - endDayOfWeek));
  }

  // Update year label
  if (heatmapYearOffset === 0) {
    yearLabelEl.textContent = 'Last year';
  } else {
    yearLabelEl.textContent = String(targetYear);
  }

  // Update prev/next button states
  const prevBtn = $('heatmap-year-prev');
  const nextBtn = $('heatmap-year-next');
  if (prevBtn) prevBtn.disabled = heatmapYearOffset <= -5;
  if (nextBtn) nextBtn.disabled = heatmapYearOffset >= 0;

  // Day names for tooltip
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Build the grid cells and track month label positions
  const cells = [];
  const monthLabels = []; // {label, columnIndex}
  let currentMonth = -1;
  let columnIndex = 0;

  const d = new Date(startDate);
  while (d <= endDate) {
    // Check if this is the start of a new week (Sunday = first day of week column)
    if (d.getDay() === 0) {
      // Check if month changed at the start of this week
      if (d.getMonth() !== currentMonth) {
        monthLabels.push({ label: monthNames[d.getMonth()], columnIndex: columnIndex });
        currentMonth = d.getMonth();
      }
      columnIndex++;
    }

    const ds = `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`;
    const mins = map[ds] || 0;
    let lvl = 'l0';
    if (mins >= 120) lvl = 'l4';
    else if (mins >= 60) lvl = 'l3';
    else if (mins >= 30) lvl = 'l2';
    else if (mins > 0) lvl = 'l1';

    // Format date for tooltip: "X minutes on Mon Jan 5, 2025" or "No activity on Mon Jan 5, 2025"
    const tooltipDate = `${dayNames[d.getDay()]}, ${monthNames[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    const tooltipText = mins > 0 ? `${mins} minute${mins!==1?'s':''} on ${tooltipDate}` : `No activity on ${tooltipDate}`;

    // Check if this date is in the future - render as empty/invisible
    const isFuture = d > today;
    const dataAttr = isFuture ? '' : `data-tooltip="${tooltipText}" data-level="${lvl}"`;
    const cellClass = isFuture ? 'heatmap-cell' : `heatmap-cell ${lvl}`;

    cells.push(`<div class="${cellClass}" ${dataAttr}></div>`);

    d.setDate(d.getDate() + 1);
  }

  grid.innerHTML = cells.join('');

  // Render month labels
  const cellSize = 11; // px
  const cellGap = 3; // px
  const stride = cellSize + cellGap; // 14px per column

  // Calculate the total number of week columns
  const totalWeeks = columnIndex;

  let monthLabelsHtml = '';
  let prevCol = 0;
  for (let i = 0; i < monthLabels.length; i++) {
    const ml = monthLabels[i];
    const leftOffset = ml.columnIndex * stride;
    // Calculate width: either to next month or to end
    let width;
    if (i < monthLabels.length - 1) {
      width = (monthLabels[i+1].columnIndex - ml.columnIndex) * stride - 4;
    } else {
      width = (totalWeeks - ml.columnIndex) * stride;
    }
    width = Math.max(width, 20);
    monthLabelsHtml += `<span class="heatmap-month-label" style="position:absolute;left:${leftOffset}px;width:${width}px">${ml.label}</span>`;
  }
  monthsEl.style.position = 'relative';
  monthsEl.style.height = '16px';
  monthsEl.style.width = (totalWeeks * stride) + 'px';
  monthsEl.innerHTML = monthLabelsHtml;

  // Set grid width for horizontal scrolling
  grid.style.width = (totalWeeks * stride) + 'px';

  // Setup tooltip
  setupHeatmapTooltip();
}

function setupHeatmapTooltip(){
  // Create tooltip element if not exists
  if (!heatmapTooltipEl) {
    heatmapTooltipEl = document.createElement('div');
    heatmapTooltipEl.className = 'heatmap-tooltip';
    document.body.appendChild(heatmapTooltipEl);
  }

  const grid = $('heatmap-grid');
  if (!grid) return;

  // Remove old listeners by replacing node
  const newGrid = grid.cloneNode(true);
  grid.parentNode.replaceChild(newGrid, grid);

  newGrid.addEventListener('mouseover', function(e) {
    const cell = e.target.closest('.heatmap-cell[data-tooltip]');
    if (cell) {
      heatmapTooltipEl.textContent = cell.getAttribute('data-tooltip');
      heatmapTooltipEl.classList.add('visible');
      positionHeatmapTooltip(cell);
    }
  });

  newGrid.addEventListener('mouseout', function(e) {
    const cell = e.target.closest('.heatmap-cell[data-tooltip]');
    if (cell) {
      heatmapTooltipEl.classList.remove('visible');
    }
  });
}

function positionHeatmapTooltip(cell) {
  const rect = cell.getBoundingClientRect();
  const tooltipRect = heatmapTooltipEl.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
  let top = rect.top - tooltipRect.height - 8;

  // Clamp to viewport
  if (left < 4) left = 4;
  if (left + tooltipRect.width > window.innerWidth - 4) left = window.innerWidth - tooltipRect.width - 4;
  if (top < 4) top = rect.bottom + 8; // Flip below if no room above

  heatmapTooltipEl.style.left = left + 'px';
  heatmapTooltipEl.style.top = top + 'px';
}

// ── Leaderboard ────────────────────────────────
async function renderLeaderboard(){
  if(isOffline){
    const medalSvg='<svg viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>';
    const topName=UP.display_name||'Local User';
    $('lb-podium').innerHTML=`<div class="lb-top-card"><div class="lb-medal">${medalSvg}</div><div class="lb-top-avatar" style="background:${avatarBg(uid())}">${initials(topName)}</div><div class="lb-top-name">${topName} <span class="lb-top-you">(You)</span></div><div class="lb-top-streak"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>${UP.current_streak||0}d</div><div class="lb-top-time">${fmtDur(UP.total_study_minutes||0)}</div></div>`;
    $('lb-rows').innerHTML=`<div class="lb-row me"><div class="lb-rank">1</div><div class="lb-user"><div class="lb-user-av" style="background:${avatarBg(uid())}">${initials(topName)}</div><div><div class="lb-user-name">${topName}</div><div class="lb-user-you">You</div></div></div><div class="lb-streak-val"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>${UP.current_streak||0}d</div><div class="lb-time-val">${fmtDur(UP.total_study_minutes||0)}</div><div class="lb-goals-val">${UP.total_goals_completed||0}</div></div>`;
    return;
  }

  const{data}=await sb.from('profiles').select('*').order('total_study_minutes',{ascending:false}).limit(50);
  const users=(data||[]).sort((a,b)=>(b.current_streak||0)-(a.current_streak||0));
  const top=users[0];
  const medalSvg='<svg viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>';
  if(top){const isMe=top.id===uid();const topName=isMe?(top.display_name||'User'):(top.username?'@'+top.username:(top.display_name||'User'));const topUn=isMe&&top.username?`<div class="lb-top-username">@${top.username}</div>`:'';$('lb-podium').innerHTML=`<div class="lb-top-card"><div class="lb-medal">${medalSvg}</div><div class="lb-top-avatar" style="background:${avatarBg(top.id)}">${initials(top.username||top.display_name)}</div><div class="lb-top-name">${topName} ${isMe?'<span class="lb-top-you">(You)</span>':''}</div>${topUn}<div class="lb-top-streak"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>${top.current_streak||0}d</div><div class="lb-top-time">${fmtDur(top.total_study_minutes||0)}</div></div>`}
  else{$('lb-podium').innerHTML=`<div class="lb-top-card"><div class="lb-medal">${medalSvg}</div><div style="color:var(--text3);padding:20px 0">No users yet</div></div>`}
  $('lb-rows').innerHTML=users.map((u,i)=>{const isMe=u.id===uid();const rank=i+1;const uName=isMe?(u.display_name||'User'):(u.username?'@'+u.username:(u.display_name||'User'));const uSub=isMe&&u.username?`<div class="lb-user-username">@${u.username}</div>`:'';return `<div class="lb-row ${isMe?'me':''}"><div class="lb-rank">${rank}</div><div class="lb-user"><div class="lb-user-av" style="background:${avatarBg(u.id)}">${initials(u.username||u.display_name)}</div><div><div class="lb-user-name">${uName}</div>${uSub}${isMe?'<div class="lb-user-you">You</div>':''}</div></div><div class="lb-streak-val"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>${u.current_streak||0}d</div><div class="lb-time-val">${fmtDur(u.total_study_minutes||0)}</div><div class="lb-goals-val">${u.total_goals_completed||0}</div></div>`}).join('');
}

// ── Community ──────────────────────────────────
async function renderCommunity(){
  if(isOffline){
    const el=$('members-list');
    const showName=UP.display_name||'Local User';
    const studying=!!UP.active_session?.clockIn;
    el.innerHTML=`<div class="member-card" onclick="viewMember('${uid()}',this)"><div class="member-av" style="background:${avatarBg(uid())}">${initials(showName)}${studying?'<div class="online-dot"></div>':''}</div><div class="member-info"><div class="member-name">${showName} <span class="you-tag">(You)</span></div><div class="member-status ${studying?'studying':''}">${studying?'Studying now':'Offline'}</div></div></div>`;
    $('community-detail').innerHTML='<div class="cd-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg><div>Sign in to see other users</div></div>';
    return;
  }

  const{data}=await sb.from('profiles').select('*');
  const users=data||[];const el=$('members-list');
  el.innerHTML=users.map(u=>{const isMe=u.id===uid();const studying=!!u.active_session?.clockIn;const showName=isMe?(u.display_name||'User'):(u.username?'@'+u.username:(u.display_name||'User'));const mUn=isMe&&u.username?`<div class="member-username">@${u.username}</div>`:'';return `<div class="member-card" onclick="viewMember('${u.id}',this)"><div class="member-av" style="background:${avatarBg(u.id)}">${initials(u.username||u.display_name)}${studying?'<div class="online-dot"></div>':''}</div><div class="member-info"><div class="member-name">${showName} ${isMe?'<span class="you-tag">(You)</span>':''}</div>${mUn}<div class="member-status ${studying?'studying':''}">${studying?'Studying now':'Offline'}</div></div></div>`}).join('');
  $('community-detail').innerHTML='<div class="cd-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg><div>Select a user to view their progress</div></div>';
}

async function viewMember(memberUid,cardEl){
  document.querySelectorAll('.member-card').forEach(c=>c.classList.remove('selected'));if(cardEl)cardEl.classList.add('selected');

  if(isOffline){
    // In offline mode, only show own card
    const u=UP;const today=todayStr();
    const gList=lsGetArr('goals').filter(g=>g.user_id===uid()&&g.date===today);
    const done=gList.filter(g=>g.completed).length;const studying=!!u.active_session?.clockIn;
    const showName=u.display_name||'Local User';
    $('community-detail').innerHTML=`<div class="cd-header"><div class="cd-avatar" style="background:${avatarBg(memberUid)}">${initials(showName)}</div><div><div class="cd-name">${showName} <span style="color:var(--accent);font-size:.75rem">(You)</span></div><div class="cd-sub">${studying?'Studying now':'Offline'}</div></div></div><div class="cd-stats"><div class="cd-stat"><div class="cd-stat-val">${u.current_streak||0}</div><div class="cd-stat-label">Day Streak</div></div><div class="cd-stat"><div class="cd-stat-val">${fmtDur(u.today_study_minutes||0)}</div><div class="cd-stat-label">Today</div></div><div class="cd-stat"><div class="cd-stat-val">${u.total_goals_completed||0}</div><div class="cd-stat-label">Goals Done</div></div></div><div class="cd-goals-title">TODAY'S GOALS (${done}/${gList.length})</div>${gList.length?gList.map(g=>`<div class="cd-goal-item"><div class="cd-check ${g.completed?'done':''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div><span style="${g.completed?'text-decoration:line-through;color:var(--text3)':''}">${g.text}</span></div>`).join(''):'<div style="color:var(--text3);font-size:.82rem;padding:12px 0">No goals set for today</div>'}`;
    return;
  }

  const{data:u}=await sb.from('profiles').select('*').eq('id',memberUid).single();if(!u)return;
  const today=todayStr();const{data:goals}=await sb.from('goals').select('*').eq('user_id',memberUid).eq('date',today);
  const gList=goals||[];const done=gList.filter(g=>g.completed).length;const isMe=memberUid===uid();const studying=!!u.active_session?.clockIn;
  const showName=isMe?(u.display_name||'User'):(u.username?'@'+u.username:(u.display_name||'User'));
  $('community-detail').innerHTML=`<div class="cd-header"><div class="cd-avatar" style="background:${avatarBg(memberUid)}">${initials(u.username||u.display_name)}</div><div><div class="cd-name">${showName} ${isMe?'<span style="color:var(--accent);font-size:.75rem">(You)</span>':''}</div><div class="cd-sub">${studying?'Studying now':'Offline'}</div></div></div><div class="cd-stats"><div class="cd-stat"><div class="cd-stat-val">${u.current_streak||0}</div><div class="cd-stat-label">Day Streak</div></div><div class="cd-stat"><div class="cd-stat-val">${fmtDur(u.today_study_minutes||0)}</div><div class="cd-stat-label">Today</div></div><div class="cd-stat"><div class="cd-stat-val">${u.total_goals_completed||0}</div><div class="cd-stat-label">Goals Done</div></div></div><div class="cd-goals-title">TODAY'S GOALS (${done}/${gList.length})</div>${gList.length?gList.map(g=>`<div class="cd-goal-item"><div class="cd-check ${g.completed?'done':''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div><span style="${g.completed?'text-decoration:line-through;color:var(--text3)':''}">${g.text}</span></div>`).join(''):'<div style="color:var(--text3);font-size:.82rem;padding:12px 0">No goals set for today</div>'}`;
}

// ── Settings ───────────────────────────────────
function loadSettings(){
  const saved=localStorage.getItem('st-settings');
  if(saved){try{settings=JSON.parse(saved)}catch(e){}}
  $('set-focus').value=settings.focusMin;$('set-short').value=settings.shortMin;$('set-long').value=settings.longMin;
  applyPomoSettings();
}
function saveSettings(){
  settings.focusMin=Math.max(1,parseInt($('set-focus').value)||25);
  settings.shortMin=Math.max(1,parseInt($('set-short').value)||5);
  settings.longMin=Math.max(1,parseInt($('set-long').value)||15);
  localStorage.setItem('st-settings',JSON.stringify(settings));
  applyPomoSettings();toast('Settings saved');
}
function applyPomoSettings(){
  if(!pomoRunning){
    if(pomoMode==='focus'){pomoTotalSeconds=settings.focusMin*60;pomoSecondsLeft=pomoTotalSeconds}
    else if(pomoMode==='short'){pomoTotalSeconds=settings.shortMin*60;pomoSecondsLeft=pomoTotalSeconds}
    else{pomoTotalSeconds=settings.longMin*60;pomoSecondsLeft=pomoTotalSeconds}
    updatePomoDisplay();
  }
  // Update mode buttons text
  document.querySelectorAll('.pomo-mode').forEach(b=>{
    if(b.textContent.includes('Focus'))b.textContent=`Focus ${settings.focusMin}m`;
    if(b.textContent.includes('Short'))b.textContent=`Short ${settings.shortMin}m`;
    if(b.textContent.includes('Long'))b.textContent=`Long ${settings.longMin}m`;
  });
}

async function exportData(){
  let data;
  if(isOffline){
    data={profile:UP,goals:lsGetArr('goals'),sessions:lsGetArr('sessions'),notes:lsGetArr('notes'),events:lsGetArr('events'),exportedAt:new Date().toISOString()};
  }else{
    const {data:goals}=await sb.from('goals').select('*').eq('user_id',uid());
    const {data:sessions}=await sb.from('sessions').select('*').eq('user_id',uid());
    const {data:notes}=await sb.from('notes').select('*').eq('user_id',uid());
    const {data:events}=await sb.from('events').select('*').eq('user_id',uid());
    data={profile:UP,goals,sessions,notes,events,exportedAt:new Date().toISOString()};
  }
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`studytrack-export-${todayStr()}.json`;a.click();URL.revokeObjectURL(url);
  toast('Data exported');
}

async function resetData(){
  if(!confirm('This will delete ALL your goals, sessions, notes, and events. Are you sure?'))return;
  if(!confirm('This cannot be undone. Really delete everything?'))return;

  if(isOffline){
    lsSet('goals',[]);lsSet('sessions',[]);lsSet('notes',[]);lsSet('events',[]);lsSet('activity',[]);
    Object.assign(UP,{current_streak:0,longest_streak:0,total_study_minutes:0,today_study_minutes:0,week_study_minutes:0,month_study_minutes:0,total_goals_completed:0,total_goals_added:0,active_session:null});
    lsSet('profile',UP);
    clockInTime=null;updateClockUI();updateDashStats();renderDashGoals();renderActivity();renderSessList();renderNotesList();
    toast('All data reset');
    return;
  }

  await sb.from('goals').delete().eq('user_id',uid());
  await sb.from('sessions').delete().eq('user_id',uid());
  await sb.from('notes').delete().eq('user_id',uid());
  await sb.from('events').delete().eq('user_id',uid());
  await sb.from('activity').delete().eq('user_id',uid());
  await sb.from('profiles').update({current_streak:0,longest_streak:0,total_study_minutes:0,today_study_minutes:0,week_study_minutes:0,month_study_minutes:0,total_goals_completed:0,total_goals_added:0,active_session:null}).eq('id',uid());
  Object.assign(UP,{current_streak:0,longest_streak:0,total_study_minutes:0,today_study_minutes:0,week_study_minutes:0,month_study_minutes:0,total_goals_completed:0,total_goals_added:0,active_session:null});
  clockInTime=null;updateClockUI();updateDashStats();renderDashGoals();renderActivity();renderSessList();renderNotesList();
  toast('All data reset');
}

// ── Pomodoro Timer ─────────────────────────────
function setPomoMode(mode){
  pomoMode=mode;
  document.querySelectorAll('.pomo-mode').forEach(b=>b.classList.remove('active'));
  event.currentTarget.classList.add('active');
  if(!pomoRunning){
    if(mode==='focus'){pomoTotalSeconds=settings.focusMin*60}
    else if(mode==='short'){pomoTotalSeconds=settings.shortMin*60}
    else{pomoTotalSeconds=settings.longMin*60}
    pomoSecondsLeft=pomoTotalSeconds;updatePomoDisplay();
  }
}

function updatePomoDisplay(){
  const min=Math.floor(pomoSecondsLeft/60);const sec=pomoSecondsLeft%60;
  const timeStr=`${p2(min)}:${p2(sec)}`;
  $('pomo-time').textContent=timeStr;
  $('focus-time').textContent=timeStr;
  // Labels
  const labelMap={focus:'Focus',short:'Short Break',long:'Long Break'};
  $('pomo-label').textContent=pomoRunning?labelMap[pomoMode]:'Ready';
  $('focus-label').textContent=labelMap[pomoMode];
  // Ring progress
  const progress=pomoTotalSeconds>0?(pomoTotalSeconds-pomoSecondsLeft)/pomoTotalSeconds:0;
  // Session ring (r=88, circumference=553)
  const sessionCirc=553;$('pomo-ring-fg').setAttribute('stroke-dashoffset',sessionCirc*(1-progress));
  // Focus ring (r=132, circumference=829)
  const focusCirc=829;$('focus-ring-fg').setAttribute('stroke-dashoffset',focusCirc*(1-progress));
  // Play button icon
  const playBtn=$('pomo-play-btn');
  if(pomoRunning){playBtn.innerHTML='<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'}
  else{playBtn.innerHTML='<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>'}
}

function togglePomo(){
  if(pomoRunning)pausePomo();else startPomo();
}

function startPomo(){
  if(pomoRunning)return;
  pomoRunning=true;
  if(pomoMode==='focus'&&!pomoFocusStart)pomoFocusStart=Date.now();
  // Auto clock in if not already
  if(!clockInTime){clockInLabel=$('sess-label').value.trim()||'Pomodoro Session';clockInTime=Date.now();
    const today=todayStr();
    if(isOffline){
      const updates={active_session:{clockIn:new Date(clockInTime).toISOString(),label:clockInLabel},last_active_date:today};
      Object.assign(UP,updates);lsSet('profile',UP);
      const activityArr=lsGetArr('activity');
      activityArr.unshift({id:'act_'+Date.now(),user_id:uid(),display_name:CU.displayName,username:UP?.username||null,type:'clockin',detail:'Clocked in (Pomodoro)',created_at:new Date().toISOString()});
      lsSet('activity',activityArr);
    }else{
      sb.from('profiles').update({active_session:{clockIn:new Date(clockInTime).toISOString(),label:clockInLabel},last_active_date:today}).eq('id',uid());
      sb.from('activity').insert({id:'act_'+Date.now(),user_id:uid(),display_name:CU.displayName,username:UP?.username||null,type:'clockin',detail:'Clocked in (Pomodoro)'});
    }
    updateClockUI();
  }
  pomoInterval=setInterval(()=>{
    pomoSecondsLeft--;
    if(pomoSecondsLeft<=0){pomoComplete();return}
    updatePomoDisplay();
  },1000);
  updatePomoDisplay();
}

function pausePomo(){
  pomoRunning=false;clearInterval(pomoInterval);pomoInterval=null;updatePomoDisplay();
}

function resetPomo(){
  pausePomo();pomoFocusStart=null;
  if(pomoMode==='focus'){pomoTotalSeconds=settings.focusMin*60}
  else if(pomoMode==='short'){pomoTotalSeconds=settings.shortMin*60}
  else{pomoTotalSeconds=settings.longMin*60}
  pomoSecondsLeft=pomoTotalSeconds;updatePomoDisplay();
}

async function pomoComplete(){
  pausePomo();
  // Play notification sound
  playNotifSound();
  // Show browser notification
  if(Notification.permission==='granted'){new Notification('StudyTrack Pomodoro',{body:`${pomoMode==='focus'?'Focus session':'Break'} complete!`,icon:'/favicon.ico'})}
  if(pomoMode==='focus'){
    pomoCount++;renderPomoTally();
    // Auto-log session
    if(pomoFocusStart){
      const dur=Math.max(1,Math.floor((Date.now()-pomoFocusStart)/60000));
      const today=todayStr();

      if(isOffline){
        const sessArr=lsGetArr('sessions');
        sessArr.push({id:'sess_'+Date.now(),user_id:uid(),date:today,clock_in:new Date(pomoFocusStart).toISOString(),clock_out:new Date().toISOString(),duration_minutes:dur,label:clockInLabel||'Pomodoro Focus'});
        lsSet('sessions',sessArr);
        const yest=dateShift(today,-1);let streak=1;if(UP.last_streak_date===yest||UP.last_streak_date===today){streak=UP.last_streak_date===today?UP.current_streak:(UP.current_streak||0)+1}
        const longest=Math.max(streak,UP.longest_streak||0);
        const updates={today_study_minutes:(UP.today_study_minutes||0)+dur,total_study_minutes:(UP.total_study_minutes||0)+dur,week_study_minutes:(UP.week_study_minutes||0)+dur,month_study_minutes:(UP.month_study_minutes||0)+dur,current_streak:streak,longest_streak:longest,last_streak_date:today,last_active_date:today};
        Object.assign(UP,updates);lsSet('profile',UP);
      }else{
        await sb.from('sessions').insert({id:'sess_'+Date.now(),user_id:uid(),date:today,clock_in:new Date(pomoFocusStart).toISOString(),clock_out:new Date().toISOString(),duration_minutes:dur,label:clockInLabel||'Pomodoro Focus'});
        const yest=dateShift(today,-1);let streak=1;if(UP.last_streak_date===yest||UP.last_streak_date===today){streak=UP.last_streak_date===today?UP.current_streak:(UP.current_streak||0)+1}
        const longest=Math.max(streak,UP.longest_streak||0);
        const updates={today_study_minutes:(UP.today_study_minutes||0)+dur,total_study_minutes:(UP.total_study_minutes||0)+dur,week_study_minutes:(UP.week_study_minutes||0)+dur,month_study_minutes:(UP.month_study_minutes||0)+dur,current_streak:streak,longest_streak:longest,last_streak_date:today,last_active_date:today};
        await sb.from('profiles').update(updates).eq('id',uid());Object.assign(UP,updates);
      }
      pomoFocusStart=null;
    }
    toast('Focus session complete!');
    // Auto switch to break
    if(pomoCount%4===0){setPomoMode('long')}
    else{setPomoMode('short')}
    document.querySelectorAll('.pomo-mode').forEach(b=>{b.classList.remove('active');if((pomoMode==='long'&&b.textContent.includes('Long'))||(pomoMode==='short'&&b.textContent.includes('Short')))b.classList.add('active')});
  }else{
    toast('Break over — time to focus!');
    setPomoMode('focus');
    document.querySelectorAll('.pomo-mode').forEach(b=>{b.classList.remove('active');if(b.textContent.includes('Focus'))b.classList.add('active')});
  }
  updateDashStats();renderSessList();
}

function renderPomoTally(){
  const el=$('pomo-tally');if(!el)return;
  let html='';for(let i=0;i<4;i++){html+=`<div class="pomo-pip ${i<pomoCount%4?'done':''} ${i===pomoCount%4&&pomoRunning&&pomoMode==='focus'?'active':''}"></div>`}
  el.innerHTML=html;
}

function playNotifSound(){
  try{
    if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();
    const osc=audioCtx.createOscillator();const gain=audioCtx.createGain();
    osc.connect(gain);gain.connect(audioCtx.destination);
    osc.frequency.setValueAtTime(587.33,audioCtx.currentTime);
    osc.frequency.setValueAtTime(783.99,audioCtx.currentTime+0.15);
    osc.frequency.setValueAtTime(1046.5,audioCtx.currentTime+0.3);
    gain.gain.setValueAtTime(0.3,audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01,audioCtx.currentTime+0.6);
    osc.start(audioCtx.currentTime);osc.stop(audioCtx.currentTime+0.6);
  }catch(e){}
}

// ── Ambient Sounds (WebAudio) ──────────────────
function initAudioCtx(){if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')audioCtx.resume()}

function createNoiseBuffer(type){
  const size=2*audioCtx.sampleRate;const buffer=audioCtx.createBuffer(1,size,audioCtx.sampleRate);const data=buffer.getChannelData(0);
  if(type==='rain'||type==='brown'){
    let last=0;for(let i=0;i<size;i++){const white=Math.random()*2-1;
      if(type==='brown'){data[i]=(last+0.02*white)/1.02;last=data[i];data[i]*=3.5}
      else{data[i]=white*0.5}// rain uses white noise base, we'll filter it
    }
  }else if(type==='waves'){
    let last=0;for(let i=0;i<size;i++){const white=Math.random()*2-1;data[i]=(last+0.01*white)/1.01;last=data[i];data[i]*=3.5;
      // modulate with slow sine for wave effect
      data[i]*=0.5+0.5*Math.sin(2*Math.PI*i/audioCtx.sampleRate*0.15);
    }
  }else if(type==='wind'){
    let last=0;for(let i=0;i<size;i++){const white=Math.random()*2-1;data[i]=(last+0.04*white)/1.04;last=data[i];data[i]*=2.5;
      data[i]*=0.3+0.7*Math.sin(2*Math.PI*i/audioCtx.sampleRate*0.08);
    }
  }
  return buffer;
}

function toggleAmbient(type,btnEl){
  initAudioCtx();
  // Sync button states across both bars
  document.querySelectorAll(`.ambient-btn[data-sound="${type}"]`).forEach(b=>b.classList.toggle('active',!ambientNodes[type]));
  if(ambientNodes[type]){stopAmbient(type);return}
  // Create the sound
  const source=audioCtx.createBufferSource();source.buffer=createNoiseBuffer(type);source.loop=true;
  const gain=audioCtx.createGain();gain.gain.value=ambientVolume;
  const filter=audioCtx.createBiquadFilter();
  if(type==='rain'){filter.type='bandpass';filter.frequency.value=8000;filter.Q.value=0.5}
  else if(type==='waves'){filter.type='lowpass';filter.frequency.value=400;filter.Q.value=0.7}
  else if(type==='wind'){filter.type='bandpass';filter.frequency.value=600;filter.Q.value=0.3}
  else{filter.type='lowpass';filter.frequency.value=200;filter.Q.value=0.5}
  source.connect(filter);filter.connect(gain);gain.connect(audioCtx.destination);
  source.start();ambientNodes[type]={source,gain,filter};
}

function stopAmbient(type){
  if(ambientNodes[type]){ambientNodes[type].source.stop();delete ambientNodes[type]}
  document.querySelectorAll(`.ambient-btn[data-sound="${type}"]`).forEach(b=>b.classList.remove('active'));
}

function stopAllAmbient(){Object.keys(ambientNodes).forEach(k=>stopAmbient(k))}

function setAmbientVol(val){
  ambientVolume=val/100;
  Object.values(ambientNodes).forEach(n=>{if(n.gain)n.gain.gain.value=ambientVolume});
}

// ── Command Palette ────────────────────────────
function buildCommandItems(){
  cmdItems=[
    {section:'Navigation',items:[
      {text:'Dashboard',shortcut:'G D',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',action:()=>showView('dashboard')},
      {text:'Goals',shortcut:'G G',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',action:()=>showView('goals')},
      {text:'Sessions',shortcut:'G S',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',action:()=>showView('sessions')},
      {text:'Notes',shortcut:'G N',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/></svg>',action:()=>showView('notes')},
      {text:'Calendar',shortcut:'G C',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/></svg>',action:()=>showView('calendar')},
      {text:'Stats',shortcut:'G T',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',action:()=>showView('stats')},
      {text:'Leaderboard',shortcut:'G L',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>',action:()=>showView('leaderboard')},
      {text:'Community',shortcut:'G O',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>',action:()=>showView('community')},
      {text:'Settings',shortcut:'G X',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33"/></svg>',action:()=>showView('settings')},
    ]},
    {section:'Actions',items:[
      {text:'Toggle Theme',shortcut:'T',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/></svg>',action:()=>toggleTheme()},
      {text:'Focus Mode',shortcut:'F',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',action:()=>openFocusMode()},
      {text:'Add Goal',shortcut:'N',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',action:()=>openModal('modal-goal')},
      {text:'Add Note',shortcut:'',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/></svg>',action:()=>openModal('modal-note')},
      {text:'Add Event',shortcut:'',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/></svg>',action:()=>openModal('modal-event')},
      {text:'Start Pomodoro',shortcut:'',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>',action:()=>{showView('sessions');if(!pomoRunning)startPomo()}},
    ]}
  ];
}

function openCommandPalette(){
  $('cmd-palette').classList.add('open');$('cmd-input').value='';$('cmd-input').focus();cmdSelectedIdx=0;renderCmdResults('');
}

function closeCmdPalette(){$('cmd-palette').classList.remove('open')}

function filterCommands(){const q=$('cmd-input').value.toLowerCase();cmdSelectedIdx=0;renderCmdResults(q)}

function renderCmdResults(query){
  const el=$('cmd-results');let html='';let idx=0;
  cmdItems.forEach(section=>{
    const filtered=section.items.filter(i=>!query||i.text.toLowerCase().includes(query));
    if(!filtered.length)return;
    html+=`<div class="cmd-section-label">${section.section}</div>`;
    filtered.forEach(item=>{
      html+=`<div class="cmd-item ${idx===cmdSelectedIdx?'selected':''}" onclick="executeCmdItem(${idx})" data-idx="${idx}"><span style="color:var(--text3)">${item.icon}</span><span class="cmd-item-text">${item.text}</span>${item.shortcut?`<span class="cmd-item-shortcut">${item.shortcut}</span>`:''}</div>`;
      idx++;
    });
  });
  if(!html)html='<div style="padding:20px;text-align:center;color:var(--text3)">No results</div>';
  el.innerHTML=html;
}

function executeCmdItem(idx){
  let count=0;let item=null;
  for(const section of cmdItems){for(const i of section.items){if(count===idx){item=i;break}count++}if(item)break}
  if(item){closeCmdPalette();item.action()}
}

function cmdKeyDown(e){
  if(e.key==='Escape'){closeCmdPalette();return}
  if(e.key==='Enter'){executeCmdItem(cmdSelectedIdx);return}
  const allItems=$('cmd-results').querySelectorAll('.cmd-item');
  if(e.key==='ArrowDown'){e.preventDefault();cmdSelectedIdx=Math.min(cmdSelectedIdx+1,allItems.length-1)}
  if(e.key==='ArrowUp'){e.preventDefault();cmdSelectedIdx=Math.max(cmdSelectedIdx-1,0)}
  allItems.forEach((el,i)=>el.classList.toggle('selected',i===cmdSelectedIdx));
  if(allItems[cmdSelectedIdx])allItems[cmdSelectedIdx].scrollIntoView({block:'nearest'});
}

// ── Focus Mode ─────────────────────────────────
function openFocusMode(){
  if(!CU){toast('Sign in to use Focus Mode','err');return}
  $('focus-overlay').classList.add('open');updatePomoDisplay();
}

function closeFocusMode(){$('focus-overlay').classList.remove('open')}

// ── Keyboard Shortcuts ─────────────────────────
let keyBuffer='';let keyTimeout=null;

document.addEventListener('keydown',e=>{
  // Don't trigger in inputs
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.tagName==='SELECT')return;
  // Ignore if modifier keys (except for Ctrl+K)
  if(e.ctrlKey||e.metaKey){
    if(e.key==='k'){e.preventDefault();openCommandPalette();return}
    return;
  }
  // Escape
  if(e.key==='Escape'){
    if($('cmd-palette').classList.contains('open')){closeCmdPalette();return}
    if($('focus-overlay').classList.contains('open')){closeFocusMode();return}
    document.querySelectorAll('.overlay.open').forEach(o=>o.classList.remove('open'));
    return;
  }
  // Space in focus mode
  if(e.key===' '&&$('focus-overlay').classList.contains('open')){e.preventDefault();togglePomo();return}

  // Buffer keys for multi-key shortcuts
  clearTimeout(keyTimeout);
  keyBuffer+=e.key.toUpperCase();
  keyTimeout=setTimeout(()=>{keyBuffer=''},800);

  // Single key shortcuts
  if(keyBuffer==='T'){toggleTheme();keyBuffer='';return}
  if(keyBuffer==='F'){openFocusMode();keyBuffer='';return}
  if(keyBuffer==='N'){openModal('modal-goal');keyBuffer='';return}
  // G prefix shortcuts
  if(keyBuffer.startsWith('G')&&keyBuffer.length===2){
    const map={'D':'dashboard','G':'goals','S':'sessions','N':'notes','C':'calendar','T':'stats','L':'leaderboard','O':'community','X':'settings'};
    const view=map[keyBuffer[1]];
    if(view){showView(view);keyBuffer='';return}
  }
  // / for command palette
  if(e.key==='/'){e.preventDefault();openCommandPalette();return}
});

// ── Init ───────────────────────────────────────
initTheme();

// Request notification permission
if('Notification' in window && Notification.permission==='default'){Notification.requestPermission()}

(async function init(){
  try {
    // Check for offline mode auto-login
    if(localStorage.getItem('st-offline')==='true'){
      isOffline=true;
      CU={id:'local_user',displayName:'Local User',email:''};
      showPage('page-app');await loadApp();
      return;
    }
    if(!sb){showPage('page-auth');return}
    const{data:{session}}=await sb.auth.getSession();
    if(session?.user){
      CU={id:session.user.id,displayName:session.user.user_metadata?.display_name||session.user.email,email:session.user.email};
      showPage('page-app');await loadApp();
    }else{showPage('page-auth')}
  } catch(e){console.error('Init error:',e);showPage('page-auth')}
})();