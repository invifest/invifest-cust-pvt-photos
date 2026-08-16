# Invifest — guest photo vault

Ek link. Guest apna naam aur number likhta hai, 20 tak photos chunta hai, aur wo
photos seedha **customer ke apne Google Drive folder** me chali jaati hain.

Isme kuch aur nahi lagta. **Koi database nahi, koi server nahi, koi Vercel
nahi.** Sirf teen cheezein:

| Kya | Kahan |
|---|---|
| Guest ka page | `index.html`, is repo me — GitHub Pages pe |
| Backend | `apps-script/Code.gs`, **customer ke apne Google account me** |
| Ledger | usi Drive folder me ek Google Sheet, script khud bana leta hai |

Photos **is repo se ya kisi bhi server se hokar nahi guzarti.** Page Google se
ek "resumable session" ka pata leta hai aur bytes phone se **seedhe Google** pe
jaate hain. Isliye 25-30 MB ki photo bhi theek hai, aur 4G beech me kat jaye to
upload wahin se resume hota hai — shuru se nahi.

---

## Ek baar ka setup (~5 minute)

Ye us Google account me karna hai **jiske Drive me photos jaani hain**.

### 1. Script banao

1. Us account se [script.google.com](https://script.google.com) kholo → **New project**
2. Naam do: `Invifest Photo Vault`
3. `Code.gs` ka poora content mita ke is repo ki `apps-script/Code.gs` paste karo
4. Baayein taraf ⚙️ **Project Settings** → "Show `appsscript.json`" ✅ karo, phir
   editor me `appsscript.json` khol ke is repo wali file paste kar do

### 2. Script Properties bharo

**Project Settings → Script Properties → Add script property**

| Property | Kya daalna hai |
|---|---|
| `SECRET` | koi bhi lambi random string — page ke `config.json` me wahi jayegi |
| `FOLDER_ID` | Drive folder ke URL ka aakhri hissa (`/folders/` ke baad) |
| `PASSCODE` | guest jo type karega. Ye **server pe** check hota hai, page me kabhi nahi |
| `FILEGARDEN_EMAIL` | *(optional)* file.garden mirror ke liye |
| `FILEGARDEN_PASSWORD` | *(optional)* |
| `FILEGARDEN_ID` | *(optional)* garden id, link me lagta hai |

`LEDGER_ID` khud ban jayegi — usay haath mat lagana.

### 3. Ek baar `setup` chalao

Editor ke upar function dropdown me **`setup`** chuno → **Run**.

Pehli baar Google poochhega: **"This app isn't verified"** → **Advanced** →
**Go to Invifest Photo Vault (unsafe)** → **Allow**. Ye apna hi script hai, aur
ye chetavni sirf isliye aati hai ki wo Google ke store me publish nahi hai.

Chal gaya to Ledger sheet ban jayegi aur mirror ka trigger (har 10 min) lag
jayega.

### 4. Deploy karo

**Deploy → New deployment → ⚙️ → Web app**

- **Execute as:** `Me`
- **Who has access:** `Anyone`
- **Deploy** → jo `/exec` URL mile use copy kar lo

### 5. Page se joro

Is repo ki `config.json` me `endpoint` aur `secret` bhar do, commit kar do. Bas.

---

## Google account badalna

Poora backend ek hi script aur ek hi folder me hai, isliye:

1. Naye account me **step 1-4 dobara** karo
2. `config.json` me `endpoint` (aur `secret`) badal do
3. Commit

**Purane account se kuch transfer nahi karna, koi folder share nahi karna, aur
guest ka link wahi ka wahi rehta hai.** Har customer ka apna block `config.json`
me rakh sakte ho — har ek ka apna Google, apna folder, apna passcode.

---

## Kya kahan jaata hai

```
guest ka phone
   → Apps Script : naam, number, passcode, files ki list
   ← 20 ke 20 upload-pate ek hi jawab me
   → bytes SEEDHE Google Drive pe (parallel, chunked, resumable)
   → Apps Script : "ho gaya" → Ledger sheet me row

Apps Script trigger (har 10 min, apne aap)
   → Drive se photo → catbox + file.garden → links Ledger me
```

Mirror **Google ke server se** chalta hai, kisi Indian ISP ke peeche se nahi —
jahan catbox ke packets girte hi nahi. Isliye yahan kisi proxy ki zarurat nahi.

Aur ek mirror girne se doosra nahi girta. Dono gir jaayein to bhi photo Drive me
surakshit hai — mirror ek suvidha hai, photo ka ghar nahi.
