/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  INVIFEST PHOTO VAULT  —  poora backend, ek hi Apps Script project me.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Ye script GOOGLE ACCOUNT KE MAALIK KE AS chalta hai. Isliye:
 *
 *    · Drive folder kisi ke saath share karne ki zarurat NAHI. Script khud hi
 *      maalik hai, to usay pehle se poori ijazat hai.
 *    · Koi Google Cloud project nahi, koi OAuth consent screen nahi, koi app
 *      verification nahi. (`auth/drive` ek restricted scope hai — uska security
 *      assessment mahine leta hai. Apne hi script ko authorise karne me wo
 *      laagu hota hi nahi.)
 *    · Koi database nahi. Ledger ek Google Sheet hai, usi folder me, jise
 *      customer khud khol ke padh sakta hai.
 *
 *  ACCOUNT BADALNA: naye Google account me yahi file paste karo, Script
 *  Properties bharo, deploy karo, aur naya /exec URL page ke `config.json` me
 *  daal do. Bas. Purane account se kuch transfer nahi karna, kuch share nahi
 *  karna.
 *
 *  PHOTOS IS SCRIPT SE HOKAR NAHI GUZARTI. Ye sirf Google se ek "resumable
 *  session" ka pata maangta hai aur wo pata page ko de deta hai — bytes phone
 *  se SEEDHE Google ke server pe jaate hain. Isliye 25 MB ki photo bhi theek
 *  hai, aur 4G beech me kat jaye to upload wahin se resume hota hai, shuru se
 *  nahi.
 *
 *  ── Script Properties (Project Settings → Script Properties) ──────────────
 *    SECRET               page ke saath baanta hua. Iske bina koi request nahi.
 *    FOLDER_ID            Drive folder jisme photos jaayengi.
 *    PASSCODE             guest ko jo type karna hai. SERVER pe check hota hai.
 *    FILEGARDEN_EMAIL     (optional) file.garden mirror ke liye
 *    FILEGARDEN_PASSWORD  (optional)
 *    FILEGARDEN_ID        (optional) garden id, URL me lagta hai
 *    LEDGER_ID            setup() khud bhar deta hai — haath mat lagao
 * ═══════════════════════════════════════════════════════════════════════════
 */

var P = PropertiesService.getScriptProperties();

var MAX_FILES = 20;
var MAX_BYTES = 200 * 1024 * 1024;   // catbox ki hadd bhi yahi hai
var MIRROR_PER_RUN = 8;              // ek trigger me itni photos mirror hongi

var COLS = ['Kab', 'Guest', 'Number', 'Kram', 'File', 'Drive ID', 'Drive link',
            'catbox', 'file.garden', 'Mirror kab hua'];


/* ═══════════════════════════════════════════════════════════════════════════
   EK BAAR CHALAO  —  editor me `setup` chun ke Run dabao.
   Ledger sheet banata hai aur mirror ka trigger lagata hai.
   ═══════════════════════════════════════════════════════════════════════════ */
function setup() {
  var need = ['SECRET', 'FOLDER_ID', 'PASSCODE'];
  for (var i = 0; i < need.length; i++) {
    if (!P.getProperty(need[i]))
      throw new Error('Script Property "' + need[i] + '" bhari nahi hai.');
  }
  var sh = ledger();

  // Purana trigger hata ke naya — dobara setup() chalane pe do trigger na banein.
  var old = ScriptApp.getProjectTriggers();
  for (var j = 0; j < old.length; j++) {
    if (old[j].getHandlerFunction() === 'mirrorTick') ScriptApp.deleteTrigger(old[j]);
  }
  ScriptApp.newTrigger('mirrorTick').timeBased().everyMinutes(10).create();

  var folder = DriveApp.getFolderById(P.getProperty('FOLDER_ID'));
  var msg = 'Taiyaar.\n\nFolder : ' + folder.getName() +
            '\nLedger : ' + sh.getParent().getUrl() +
            '\nMirror : har 10 minute';
  Logger.log(msg);
  return msg;
}


/* ═══════════════════════════════════════════════════════════════════════════
   PAGE KE REQUESTS
   ═══════════════════════════════════════════════════════════════════════════ */

function doGet() {
  // Sirf ye batane ke liye ki deployment zinda hai. Koi data nahi deta.
  return out({ ok: true, service: 'invifest-photo-vault' });
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { }

  // Ye SECRET page ke andar hota hai, to sach me chhupa hua nahi hai. Iska kaam
  // sirf random bots ko door rakhna hai. Asli darwaza PASSCODE hai, jo neeche
  // server pe check hota hai — page pe kabhi nahi.
  if (String(body.secret || '') !== String(P.getProperty('SECRET') || ''))
    return out({ ok: false, error: 'not allowed' });

  try {
    if (body.op === 'ping')  return out(ping());
    if (body.op === 'slots') return out(slots(body));
    if (body.op === 'done')  return out(done(body));
  } catch (err) {
    return out({ ok: false, error: String(err && err.message || err).slice(0, 200) });
  }
  return out({ ok: false, error: 'unknown op' });
}

function out(obj) {
  // Apps Script web app ka jawab apne aap `Access-Control-Allow-Origin: *`
  // ke saath aata hai. Page ko `Content-Type: text/plain` bhejna hota hai —
  // wo "simple request" hai, isliye browser preflight (OPTIONS) nahi bhejta,
  // aur Apps Script OPTIONS ka jawab de hi nahi sakta.
  return ContentService.createTextOutput(JSON.stringify(obj))
                       .setMimeType(ContentService.MimeType.JSON);
}

function ping() {
  var f = DriveApp.getFolderById(P.getProperty('FOLDER_ID'));
  return { ok: true, folder: f.getName(), maxFiles: MAX_FILES };
}


/* ═══════════════════════════════════════════════════════════════════════════
   SLOTS  —  ek hi jawab me saare upload ke pate.

   Ek request me 20 ke 20 session bana ke lautaye jaate hain. Har photo ke liye
   alag round-trip karne pe phone ko 20 baar Google tak jaana padta; yahan ek
   baar. Upload ke waqt ka sabse bada hissa yahi bachta hai.
   ═══════════════════════════════════════════════════════════════════════════ */
function slots(body) {
  var want = String(P.getProperty('PASSCODE') || '').trim().toLowerCase();
  var got  = String(body.passcode || '').trim().toLowerCase();
  if (want && got !== want) return { ok: false, error: 'Passcode galat hai' };

  var name  = String(body.guestName  || '').trim();
  var phone = String(body.guestPhone || '').trim();
  if (name.length < 2)                       return { ok: false, error: 'Apna naam likhiye' };
  if (!/^[0-9+\-\s()]{7,20}$/.test(phone))   return { ok: false, error: 'Number theek nahi lag raha' };

  var files = body.files || [];
  if (!files.length)             return { ok: false, error: 'Koi photo chuni hi nahi' };
  if (files.length > MAX_FILES)  return { ok: false, error: 'Ek baar me ' + MAX_FILES + ' tak' };

  var folder = guestFolder(name, phone);
  var token  = ScriptApp.getOAuthToken();
  var stamp  = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'ddMMM-HHmm');
  var slots  = [];

  for (var i = 0; i < files.length; i++) {
    var f    = files[i] || {};
    var mime = String(f.mime || '');
    var size = Number(f.size || 0);

    if (mime.indexOf('image/') !== 0) { slots.push({ error: 'Sirf photos bhej sakte hain' }); continue; }
    if (size > MAX_BYTES)             { slots.push({ error: 'Ye photo bahut badi hai' });     continue; }

    // Naam me guest ka naam aur kram dono — customer ko folder kholte hi pata
    // chal jaaye kisne kya bheja, aur kis order me.
    var n = pad(i + 1) + ' - ' + clean(name) + ' - ' + stamp + ext(f.name, mime);
    slots.push(startUpload(token, folder.getId(), n, mime, body.origin));
  }
  return { ok: true, folderId: folder.getId(), slots: slots };
}

/**
 * Google se ek resumable session ka pata maangna.
 *
 * Jawab body me nahi, `Location` HEADER me aata hai — isliye followRedirects
 * band hai, warna UrlFetchApp us pate par khud hi chala jaata aur header hamare
 * haath na aata.
 */
function startUpload(token, folderId, name, mime, origin) {
  var res = UrlFetchApp.fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true',
    {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + token,
        // Browser ko is session par PUT karne ki ijazat mile, iske liye Google
        // ko wo origin pata hona chahiye jahan se page chal raha hai.
        Origin: String(origin || '')
      },
      payload: JSON.stringify({ name: name, parents: [folderId], mimeType: mime }),
      followRedirects: false,
      muteHttpExceptions: true
    });

  var h = res.getAllHeaders() || {};
  var loc = h['Location'] || h['location'];
  if (Array.isArray(loc)) loc = loc[0];
  if (!loc) {
    return { error: 'Google ne session nahi diya (' + res.getResponseCode() + '): ' +
                    String(res.getContentText()).slice(0, 120) };
  }
  return { url: loc, name: name };
}


/* ═══════════════════════════════════════════════════════════════════════════
   DONE  —  jo chadh gayi, wo ledger me likh do.
   ═══════════════════════════════════════════════════════════════════════════ */
function done(body) {
  var sh   = ledger();
  var rows = [];
  var list = body.uploaded || [];
  var now  = new Date();

  for (var i = 0; i < list.length; i++) {
    var u = list[i] || {};
    if (!u.id) continue;
    rows.push([now, String(body.guestName || ''), String(body.guestPhone || ''),
               Number(u.order || i + 1), String(u.name || ''), String(u.id),
               'https://drive.google.com/file/d/' + u.id + '/view', '', '', '']);
  }
  if (rows.length) {
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, COLS.length).setValues(rows);
  }
  return { ok: true, saved: rows.length };
}


/* ═══════════════════════════════════════════════════════════════════════════
   MIRROR  —  har 10 minute, apne aap, guest ko bina rokay.

   🚨 Ye Google ke server se chalta hai, kisi Indian ISP ke peeche se nahi —
   catbox ke packets wahan girte hi nahi, isliye yahan kisi proxy ki zarurat
   nahi padti.

   Har photo apne aap me alag hai: catbox gir jaye to file.garden phir bhi
   chalega, aur dono gir jaayein to bhi photo Drive me surakshit hai. Mirror
   ek suvidha hai, photo ka ghar nahi.
   ═══════════════════════════════════════════════════════════════════════════ */
function mirrorTick() {
  var sh = ledger();
  var last = sh.getLastRow();
  if (last < 2) return;

  var data   = sh.getRange(2, 1, last - 1, COLS.length).getValues();
  var budget = MIRROR_PER_RUN;

  for (var i = 0; i < data.length && budget > 0; i++) {
    if (data[i][7]) continue;                 // catbox column bhara hai = ho chuka
    var id = String(data[i][5] || '');
    if (!id) continue;

    var row = i + 2;
    budget--;
    var blob;
    try {
      blob = DriveApp.getFileById(id).getBlob();
    } catch (err) {
      sh.getRange(row, 8).setValue('ERR drive: ' + String(err).slice(0, 60));
      continue;
    }

    try { sh.getRange(row, 8).setValue(toCatbox(blob)); }
    catch (err) { sh.getRange(row, 8).setValue('ERR ' + String(err && err.message || err).slice(0, 70)); }

    try {
      var g = toGarden(blob, String(data[i][4] || id));
      if (g) sh.getRange(row, 9).setValue(g);
    } catch (err) {
      sh.getRange(row, 9).setValue('ERR ' + String(err && err.message || err).slice(0, 70));
    }

    sh.getRange(row, 10).setValue(new Date());
  }
}

function toCatbox(blob) {
  var res = UrlFetchApp.fetch('https://catbox.moe/user/api.php', {
    method: 'post',
    payload: { reqtype: 'fileupload', fileToUpload: blob },
    muteHttpExceptions: true
  });
  var t = String(res.getContentText() || '').trim();
  if (res.getResponseCode() !== 200 || t.indexOf('https://') !== 0)
    throw new Error(t.slice(0, 100) || ('HTTP ' + res.getResponseCode()));
  return t;
}

/**
 * file.garden. Uska API kahin likha hua nahi hai — teen ajeeb shartein hain:
 * likhne ke liye TOKEN nahi, COOKIE chahiye; X-Data saada JSON hota hai; aur
 * Content-Type octet-stream, asli mime nahi.
 *
 * 🚨 file.garden file ko NAAM se rakhta hai, id se nahi. Do guest ki photo ka
 * naam ek hua to doosri chup-chaap gum ho jaati. Isliye naam ke saath file ka
 * Drive id joda jaata hai — wo har file ka alag hota hai.
 */
var fgSession = null;

function toGarden(blob, name) {
  var email = P.getProperty('FILEGARDEN_EMAIL');
  var pass  = P.getProperty('FILEGARDEN_PASSWORD');
  if (!email || !pass) return '';           // set nahi hai to ye mirror chhod do
  var garden = P.getProperty('FILEGARDEN_ID') || '';

  for (var attempt = 1; attempt <= 2; attempt++) {
    if (!fgSession || attempt > 1) fgSession = fgSignIn(email, pass);
    var res = UrlFetchApp.fetch('https://api.filegarden.com/users/' + fgSession.user + '/pipe', {
      method: 'post',
      headers: {
        Cookie: fgSession.cookie,
        'X-Data': JSON.stringify({ name: name, type: blob.getContentType(), parent: null })
      },
      contentType: 'application/octet-stream',
      payload: blob.getBytes(),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    var text = String(res.getContentText() || '');
    if (code === 401 || code === 403) { fgSession = null; continue; }
    // Wahi naam pehle se wahan hai — link to wahi banega, to ise kaamyaab maano.
    if (code >= 400 && !/already exists/i.test(text)) throw new Error(code + ' ' + text.slice(0, 80));
    return 'https://file.garden/' + garden + '/' + encodeURIComponent(name);
  }
  throw new Error('file.garden: login nahi chala');
}

function fgSignIn(email, pass) {
  var r = UrlFetchApp.fetch('https://api.filegarden.com/token', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ connection: 'password ' + Utilities.base64Encode(pass), email: email }),
    muteHttpExceptions: true
  });
  if (r.getResponseCode() !== 200) throw new Error('login ' + r.getResponseCode());
  var j = JSON.parse(r.getContentText());
  var raw = (r.getAllHeaders() || {})['Set-Cookie'];
  if (!raw) throw new Error('login to hua par cookie nahi mili');
  if (!Array.isArray(raw)) raw = [raw];
  var cookie = raw.map(function (c) { return String(c).split(';')[0]; }).join('; ');
  return { user: j.id, cookie: cookie };
}


/* ═══════════════════════════════════════════════════════════════════════════
   CHHOTE KAAM
   ═══════════════════════════════════════════════════════════════════════════ */

/** Har guest ka apna folder — customer ko dekhte hi pata chale kisne kya bheja. */
function guestFolder(name, phone) {
  var root  = DriveApp.getFolderById(P.getProperty('FOLDER_ID'));
  var digits = phone.replace(/\D/g, '');
  var label = clean(name) + ' - ' + digits.slice(-10);
  var it = root.getFoldersByName(label);
  return it.hasNext() ? it.next() : root.createFolder(label);
}

/** Ledger sheet — nahi hai to usi folder me bana do, aur uska id yaad rakh lo. */
function ledger() {
  var id = P.getProperty('LEDGER_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id).getSheets()[0]; } catch (err) { /* mit gayi, dobara bana lo */ }
  }
  var ss = SpreadsheetApp.create('Invifest Photo Ledger');
  var sh = ss.getSheets()[0];
  sh.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold');
  sh.setFrozenRows(1);

  // Sheet ko usi folder me le jao jahan photos hain, taaki sab ek jagah rahe.
  var file = DriveApp.getFileById(ss.getId());
  var root = DriveApp.getFolderById(P.getProperty('FOLDER_ID'));
  root.addFile(file);
  DriveApp.getRootFolder().removeFile(file);

  P.setProperty('LEDGER_ID', ss.getId());
  return sh;
}

function clean(s) {
  return String(s).replace(/[^A-Za-z0-9 ._ऀ-ॿ-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 50);
}

function pad(n) { return (n < 10 ? '0' : '') + n; }

/** Extension file ke naam se, aur na mile to mime se. */
function ext(fileName, mime) {
  var m = String(fileName || '').match(/(\.[A-Za-z0-9]{2,5})$/);
  if (m) return m[1].toLowerCase();
  var t = String(mime || '').split('/')[1] || 'jpg';
  return '.' + t.replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '');
}
