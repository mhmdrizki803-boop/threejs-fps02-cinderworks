# Harness taktik

Harness browser untuk ekonomi bot, payout ronde, papan skor, anchor site,
recovery core, plant/defuse fisik, granat, perception, serta integrasi tembak.

## Menjalankan

Dari `/home/ubuntu/work/fps2/repo`:

```bash
CHROME_BIN=/home/ubuntu/.hermes/tools/chromium-1208/chrome-linux64/chrome \
  node tests/tactics.mjs
```

Dependensi:

- Node.js 22.18+ atau 24+, yang dapat menjalankan `serve.ts` langsung.
- `playwright-core`, tersedia di `/home/ubuntu/work/fps2/shots/node_modules/playwright-core/index.mjs`.
- Executable Chromium pada `CHROME_BIN`. Nilai default memakai executable pada contoh di atas.
- Port localhost **8188** tersedia. Harness menjalankan `node serve.ts --port 8188` dengan direktori kerja repo.

Modul Playwright dimuat menggunakan dynamic import. Default
`../../shots/node_modules/playwright-core/index.mjs` dihitung relatif terhadap
`tests/tactics.mjs`. Untuk lokasi dependensi lain, gunakan path absolut atau URL `file:`:

```bash
PLAYWRIGHT_MODULE=/lokasi/node_modules/playwright-core/index.mjs \
CHROME_BIN=/lokasi/chromium/chrome \
  node tests/tactics.mjs
```

Pemeriksaan sintaks:

```bash
node --check tests/tactics.mjs
```

Verifikasi entrypoint dan dossier (stdlib Node saja, tanpa CLI make.fun):

```bash
node tests/dossier.mjs
```

Tes ini menjalankan `main.ts` dua kali di direktori sementara `/tmp/opencode`,
membandingkan seluruh output byte-per-byte, memeriksa sintaks modul, source
utuh tanpa `[Cut at`, cap teks 163840 byte, dan empat screenshot di dossier.
Output sementara milik tes dibersihkan setelah selesai.

## Perilaku dan cakupan

- Chromium headless memakai `--no-sandbox`, `--disable-dev-shm-usage`,
  `--use-gl=angle`, `--use-angle=swiftshader`, dan `--enable-unsafe-swiftshader`.
- Startup server dibatasi 15 detik, launch Chromium 30 detik, pemuatan halaman
  45 detik, dan tiap kasus 30 detik. Browser dan proses server dibersihkan dalam
  `finally`; server mendapat SIGKILL jika SIGTERM belum menghentikannya.
- Halaman `http://localhost:8188/?shot=menu&seed=3` membekukan simulasi otomatis.
  Tiap kasus dimulai dengan `restartMatch('attack')` atau `restartMatch('defend')`
  dan input kosong. Runner juga memulihkan `botCtx.combatants` ke
  `[player.state, ...bots.roster]`, referensi player/bomb/roster, `now` ke
  `match.state.now`, serta `attackerTeam` ke tim attacker saat ini.
  API/callback asli juga dipulihkan sebelum restart, sehingga override
  `effects`, audio, callback damage/noise, atau method tidak bocor antar-kasus.
  Fixture pembelian berada di bawah harga Talon agar pilihan senjata acak
  tidak memengaruhi hasil.
- Route `/src/main.js` membaca langsung `game/src/main.js` dan menambahkan
  `window.testGame` dalam respons browser. API yang diekspos:
  `{map,bots,match,player,input,loadout,botCtx,matchCtx,hud,rowsForBoard,pickupBombIfDropped,updateObjective,simulationStep,restartMatch,buyItem,shoot,applyDamage,grenades,updateGrenades,effects,scene,throwGrenade}`.
- Semua request browser harus memiliki origin `http://localhost:8188`.
  Request eksternal diblokir dan menyebabkan kegagalan. `pageerror`, console
  error, request gagal, respons HTTP error, serta error routing/proses server
  juga dilaporkan sebagai assertion.
- Default mencetak hasil per kasus dan seluruh assertion yang gagal beserta
  aktual, harapan, dan bukti. `node tests/tactics.mjs --verbose` mencetak setiap
  assertion yang lolos juga. Ringkasan memuat jumlah assertion dan kasus.
  Exit code `0` berarti semua assertion lolos; `1` berarti ada kegagalan.

Kasus mencakup:

1. Dua kekalahan dan uang $2000: sekutu eco menyimpan uang; lawan tanpa streak
   membeli Rattler + armor; saldo seluruh bot tetap integer dan tidak negatif.
2. Satu kekalahan tetap membeli normal.
3. Tepat $3350 membeli Longbow ($2700) + armor ($650), dengan saldo $0.
4. Streak default dan saldo di atas ambang tidak memicu eco; streak tetap
   khusus tim saat pemain memilih defender.
5. Tiga panggilan buy saat eco mempertahankan uang, primary, armor parsial,
   serta status helmet/kit. Reset streak memulihkan pembelian.
6. Transisi ronde nyata meneruskan `match.state.lossStreak` ke `bots.buy`.
7. Judul `.board-team.ember h3` dan `.board-team.warden h3` menampilkan
   `TOTAL $<integer>`, termasuk uang pemain dan bot mati. Kedua total diperiksa
   setelah kill reward pemain/bot, pembelian pemain/bot, dan kematian pemain.
8. Helmet $1000 mencakup armor100; barang yang sudah dimiliki tidak dibayar
   ulang. Kit $400 hanya dapat dibeli defender.
9. `finishRound` membayar kemenangan $3250 dan kekalahan pertama $1400 untuk
   kedua tim, termasuk bot mati, pada kedua pilihan tim pemain. Pemanggilan
   duplikat tidak membayar ulang.
10. Bonus kalah berturut-turut: $1400, $1900, $2400, $2900, $3400, $3400.
    Payout dan kill reward dibatasi $16000.
11. Halftime mempertahankan skor, mereset uang/streak sebelum pembelian, dan
    berganti sisi. Kemenangan ketujuh mengakhiri match; restart mereset
    skor/streak, pemenang, timer, dan karier.

Harapan pengujian memakai nilai kontrak eksplisit. Kegagalan assertion tetap
tercatat sambil menjalankan kasus berikutnya; timeout menghentikan rangkaian.

## Step 2: bukti navigasi dan objective

Baseline sampai step 2: **205 asersi ekonomi + 143 asersi navigasi = 348 asersi**,
dalam **32 kasus**. Kasus-kasus ini tetap menjadi bagian dari harness.

| Cakupan baru | Kasus | Asersi |
| --- | ---: | ---: |
| Hold A `(-12,-8)` / B `(12,-8)`, grid/body bebas collision, garis pandang ke approach | 1 | 6 |
| Dua anchor, satu per site; kedua pilihan tim pemain × awal/halftime; perjalanan dari spawn dan sudut stabil | 4 | 56 |
| Reset `botCtx` sesudah fixture navigasi mengubah perception, clock, dan attacker | 1 | 2 |
| Noise benar-benar tercatat; anchor tetap holding saat alert aktif dan setelah kedaluwarsa | 1 | 8 |
| Recovery terdekat mengalahkan target/memori/path lama; cover tetap pada route; recoverer mati digantikan | 1 | 8 |
| Picker terdekat dibanding dua attacker dalam radius, dengan defender/bot mati yang lebih dekat | 1 | 6 |
| Defender/player defender dan attacker mati dilewati; batas ketat `<1.3` | 1 | 3 |
| Carrier pemain mati → recovery dan plant A; carrier bot mati → recovery dan plant B | 2 | 30 |
| Anchor B retake A dengan kit; anchor A retake B tanpa kit; defuse fisik dan kemenangan ronde | 2 | 24 |

Metode deterministik:

- `botCtx.combatants = []` mengisolasi perception. Status target/memori/path
  lama hanya dipasang pada calon recoverer yang sedang diuji; bot cover
  mempertahankan perilaku route nyata.
- Tiap tick menaikkan `botCtx.now` dan menyamakan `match.state.now`, lalu
  memanggil `bots.step(1 / 60, botCtx)`. Tes objective melanjutkan dengan
  `pickupBombIfDropped()` dan `updateObjective(1 / 60)`. Maksimum perjalanan
  adalah 1800 tick (30 detik logis); timer ronde tidak ikut melompati fase.
- Posisi actor dipasang saat fixture awal. Selama perjalanan, posisi hanya
  berubah lewat kode game. Trace memeriksa collision menggunakan
  `createMover(map.colliders)`, jarak yang ditempuh, dan langkah maksimum
  `0.081` meter per tick; posisi awal/akhir menjadi bukti anti-teleport.
- Anchor berangkat dari spawn hasil `resetRound`, mencapai jarak `<0.9` dari
  hold, mendapat 90 tick untuk menghadap approach, lalu diuji selama 120 tick
  holding tanpa pergerakan. Galat yaw dibungkus pada sudut ±π dan dibatasi
  `1e-6` radian, menghadap approach A `(-12,-1)` / B `(12,-1)`.
- Recovery melalui kematian memakai `applyDamage`. Kompetisi picker memakai
  jarak berbeda agar bebas tie, dan memeriksa progress plant reset pada drop
  maupun pickup, site baru, route langsung ke site, serta repath reset.
- Tes plant memakai perjalanan/pickup nyata dan progress parsial dari
  `updateObjective`: durasi penuh 3.2 detik, dengan toleransi satu tick untuk
  floating point. Core akhirnya berada di posisi plant fisik bot.
- Fixture retake memasang core lewat `match.plant` dan menyisakan satu defender
  untuk mengukur kit secara mandiri. Defender itu berangkat dari hold site
  lain. Progress setelah 120 tick harus 0.4 dengan kit atau 0.2 tanpa kit;
  penyelesaian memerlukan 5/10 detik penuh, dengan toleransi satu tick.

## Step 3: granat, perception, dan tembakan aktual

Ekspektasi eksekusi normal: **348 asersi baseline + 83 asersi baru = 431 asersi**,
dalam **44 kasus**. Jumlah ini adalah harapan, bukan klaim kelulusan runtime.

| Cakupan baru | Kasus | Asersi |
| --- | ---: | ---: |
| Kurva `fragDamage`, body center 3D, tepi radius/elevasi, dan perlindungan wall | 3 | 17 |
| Factory/reset afterimage, faktor gun/moving, penurunan linear dan baseline tepat di akhir | 1 | 7 |
| Flash pop: facing/jarak/dead/wall; immediate blind; engage nyata membaca afterimage | 3 | 28 |
| Smoke radius/life nyata, immediate lock break, reacquire dan reaction delay | 1 | 12 |
| Acquire melalui map LOS dan engage setelah target terlihat | 1 | 5 |
| Input firing/locked/panel HUD → `simulationStep` → shoot/raycast/damage/HUD aktual | 1 | 9 |
| Pemulihan override pada exception dan guard sebelum restart berikutnya | 2 | 5 |

Fixture dan bukti:

- Modul `/src/combat.js`, `/src/bots.js`, dan `/src/weapon.js` dimuat lewat
  dynamic import browser; import map halaman menangani `three`.
- Pop selalu memakai `throwGrenade(type)` nyata. Mesh granat pertama dipasang
  pada koordinat fixture, velocity dibuat nol dan fuse nol, kemudian
  `updateGrenades(0)` dijalankan. Setiap pop memeriksa stok, owner/scene,
  antrean akhir kosong, pelepasan mesh, serta event disposal geometry/material.
- Granat tetap memakai combatants main yang tertutup atas player + roster.
  Fixture hanya mengubah entitas tersebut, dengan health200 dan armor0 agar
  damage parsial tidak memicu kematian/payout. Untuk frag, pusat `(0,0.88,8)`
  menghasilkan jarak body 0 / 3.75 / 7.5; actor pada elevasi10 membuktikan jarak
  3D. Wall dari `(-12,-4)` ke `(-8,-4)` diuji bersama kontrol pada sisi ledakan,
  dan kedua body berada di luar collider.
- Flash dekat memakai offset `(0.6,0.8)` di area terbuka. Blind berlangsung
  4.5 detik pada jarak dekat atau 2.8 detik pada jarak jauh, lalu diikuti
  afterimage2.5 detik. Bot pada jarak `<5.5` menerima flash periferal meski
  membelakangi; bot membelakangi pada jarak `>=5.5`, bot mati, di luar
  jangkauan, atau di balik wall harus mempertahankan timer bersih.
- Tes engage memakai bot dan player aktual. Full blind diuji dengan target
  lama dan `thinkTimer=60`; mag serta callback tembak tetap nol. Setelah blind,
  acquire memakai reaction delay normal. Getter observasi `dazzledUntil`
  meneruskan baca/tulis nilai asli dan memeriksa stack `botAimError` dari
  `engage` saat tembakan; tracer/audio tetap memanggil method game asli.
- Smoke memakai cloud nyata pada `(0,0.35,8)`, radius2.45 dan life13. Ray pada
  offset x=2.44 memblokir; x=2.45/2.46 tidak. Cloud masih memblokir setelah
  `effects.update(12.9)` dan dihapus setelah tambahan0.2 detik. Perception
  memakai pasangan body bebas collider `(2,12)` / `(-2,4)` dan reaction delay
  diuji sesudah cloud hilang.
- Gunplay memakai event mousedown/mouseup pada handler input game dan fixture
  `input.state.locked`. Gate unlocked/buy/board harus menjaga ammo; setelah
  gate terbuka, `simulationStep(1/60)` menjalankan shoot/raycast/applyDamage
  aktual dan memperbarui ammo HUD. Shot mode menghilangkan spread player agar
  satu hit body Longbow bernilai34 secara deterministik.
- Tes AI membandingkan ammo, callback/tracer, reaction, dan faktor aim;
  tidak menggunakan statistik hit-rate. Wrapper observasi selalu meneruskan
  panggilan ke implementasi asli dan dipulihkan dalam `finally`.

## Menambah pengujian bot, granat, atau gunplay

Tambahkan `test('Nama kasus', async (page) => { ... })` sebelum `main()`.
Argumen ketiga opsional adalah `'attack'` atau `'defend'`; runner otomatis
melakukan restart dan membersihkan input sebelum kasus.

Di `page.evaluate`, gunakan `window.testGame` untuk API permainan dan
`window.tactics` untuk fixture/snapshot:

- `setEconomy(...)`: memasang uang, streak, primary, armor, helmet, dan kit;
  kemudian menyinkronkan gun bot.
- `restoreBotContext()`: memulihkan semua referensi perception, tim, dan clock
  yang dipakai fixture. Panggil setelah restart tambahan di dalam kasus.
- `restoreAPIs()` / `withAPIs(callback)`: memulihkan descriptor API game dan
  konteks. Wrapper mendukung callback async serta pemulihan pada exception;
  runner memakai baseline API sebelum setiap restart.
- `APIsOriginal()`: memeriksa identitas method/callback dan referensi
  effects/audio terhadap baseline.
- `isolateBots()`: menyinkronkan konteks, mengosongkan combatants, membuka fase
  live, dan membersihkan input untuk pengujian bot tanpa lawan terlihat.
- `prepareEffects()` / `perceptionPair(from,to,now)`: fixture entitas aktual
  health200/armor0 dan pasangan bot-player untuk pengujian perception tanpa
  tembakan bot lain; body pair divalidasi terhadap collider.
- `popGrenade(type,point)`: throw/pop nyata dengan snapshot stok dan disposal.
- `observeCombat()`: wrapper pass-through untuk damage, audio shot, dan tracer;
  gunakan di dalam `withAPIs`.
- `bots()`, `balances()`, `match()`: snapshot scalar untuk assertion Node.
- `actor(bot)`, `bomb()`: snapshot posisi, role/interaction, route/repath,
  carrier, defuser, serta progress objective.
- `blocked(x,z,bot)`: menguji ruang body actor pada collider game.
- `board()`: memanggil `hud.refreshBoard(rowsForBoard(), match.state)` dan
  mengambil judul, label total, serta baris DOM.
- `step(ticks)`: menjalankan `simulationStep(1 / 60)` sebanyak tick integer
  yang ditentukan, tanpa menunggu waktu nyata.
- `botTick({objectives,beforeObjective})`: satu tick bot dengan jam manual;
  hook berada sesudah pickup dan sebelum update objective.
- `advanceBots(ticks,{watch,objectives,until,face,beforeObjective,observe})`:
  menjalankan tick terbatas sambil mengumpulkan trace collision/pergerakan,
  durasi holding, dan galat yaw. `until` menghentikan perjalanan ketika tujuan
  nyata tercapai; hook dapat mengukur progress/timing objective.
- `settleAnchors()`: perjalanan dari spawn sampai dua anchor benar-benar
  holding, disertai pemanasan yaw dan hasil trace.

Gunakan `equal(label, aktual, harapan, buktiOpsional)` agar assertion baru ikut
dihitung dan menghasilkan bukti `PASS`/`FAIL`. Callback `page.evaluate` harus
mandiri atau menerima argumen serializable; hindari sleep, fixture acak, dan
harapan yang dihitung dari implementasi yang sedang diuji.
