# WorkoutPWA（HTTPS配信用：静的ファイル版）

この一式は「サーバーにアップするだけ」でiPhoneのPWA（ホーム画面に追加）が動きます。
（ASP.NET不要。純粋な静的サイトです）

## 置き場所（例）
https://あなたのドメイン/workout/

サーバー上で `workout/` フォルダを作り、ZIPの中身を全部アップロードしてください。
（index.html と同じ階層に app.js / app.css / sw.js / manifest.webmanifest / icons/ がある状態）

## iPhone
1) Safariで上のURLを開く（HTTPS）
2) 共有 →「ホーム画面に追加」

## 注意
- Service Worker（sw.js）は “同じフォルダ配下” が対象範囲です。
  例：/workout/ に置いたなら、アプリの範囲は /workout/ 以下になります。
- .webmanifest のMIMEが合わないサーバーがあるので、同梱の .htaccess を一緒に置いてください。
