# Harness taktik

Harness browser untuk kontrak ekonomi bot, payout ronde, dan total uang papan skor.

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
  dan input kosong. Fixture pembelian berada di bawah harga Talon agar pilihan
  senjata acak tidak memengaruhi hasil.
- Route `/src/main.js` membaca langsung `game/src/main.js` dan menambahkan
  `window.testGame` dalam respons browser. API yang diekspos:
  `{map,bots,match,player,input,loadout,botCtx,matchCtx,hud,rowsForBoard,pickupBombIfDropped,updateObjective,simulationStep,restartMatch,buyItem,shoot,applyDamage,grenades,updateGrenades,effects,scene,throwGrenade}`.
- Semua request browser harus memiliki origin `http://localhost:8188`.
  Request eksternal diblokir dan menyebabkan kegagalan. `pageerror`, console
  error, request gagal, respons HTTP error, serta error routing/proses server
  juga dilaporkan sebagai assertion.
- Setiap assertion mencetak nomor, `PASS`/`FAIL`, nama kasus, aktual, harapan,
  dan bukti tambahan bila relevan. Ringkasan memuat jumlah assertion dan kasus.
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

## Menambah pengujian bot, granat, atau gunplay

Tambahkan `test('Nama kasus', async (page) => { ... })` sebelum `main()`.
Argumen ketiga opsional adalah `'attack'` atau `'defend'`; runner otomatis
melakukan restart dan membersihkan input sebelum kasus.

Di `page.evaluate`, gunakan `window.testGame` untuk API permainan dan
`window.tactics` untuk fixture/snapshot:

- `setEconomy(...)`: memasang uang, streak, primary, armor, helmet, dan kit;
  kemudian menyinkronkan gun bot.
- `bots()`, `balances()`, `match()`: snapshot scalar untuk assertion Node.
- `board()`: memanggil `hud.refreshBoard(rowsForBoard(), match.state)` dan
  mengambil judul, label total, serta baris DOM.
- `step(ticks)`: menjalankan `simulationStep(1 / 60)` sebanyak tick integer
  yang ditentukan, tanpa menunggu waktu nyata.

Gunakan `equal(label, aktual, harapan, buktiOpsional)` agar assertion baru ikut
dihitung dan menghasilkan bukti `PASS`/`FAIL`. Callback `page.evaluate` harus
mandiri atau menerima argumen serializable; hindari sleep, fixture acak, dan
harapan yang dihitung dari implementasi yang sedang diuji.
