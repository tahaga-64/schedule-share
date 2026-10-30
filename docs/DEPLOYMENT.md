# 共有サーバーへの配置

## 必要なもの

Node.js 24以上を実行できる常時稼働サーバー、SQLiteファイルを残せるローカルディスク、HTTPSで開けるURLを使います。サーバーは任意の会社・個人・既存機器・サービスで用意できますが、あなたのPCを停止しても使う要件なら、そのPCを本番サーバーにしません。

Google/Firebase/CloudflareやGitHubログインは実行時に使いません。ソース配布先もGitHubに固定しません。ZIPやGit bundleでも移せます。Node.jsまたはDocker等の実行環境への依存はあります。

## 保存先

DATA_DIRまたは--data-dirで指定するフォルダにschedule.sqliteと.access-links.jsonを保存します。未指定ならアプリ直下の.runtimeです。新しいSQLiteを初めて作る時だけ空の初期データを投入し、再起動では既存データを保持します。

本番のデータフォルダは、コードのチェックアウトやデプロイのたびに消されない場所へ置きます。1つのデータフォルダは1プロセスだけで使います。

## 起動とURL

PUBLIC_ORIGINに実際のHTTPS URL（末尾スラッシュなし）を設定します。リバースプロキシはHostとX-Forwarded-Protoを正しく渡し、/api/eventsのレスポンスをバッファせず、長時間接続を許可します。アプリの内部ポートを一般公開せず、プロキシから接続できる範囲に制限します。

~~~sh
node server/index.mjs --host=0.0.0.0 --access=link --data-dir=/srv/schedule-data
node scripts/links.mjs --data-dir=/srv/schedule-data --base-url=https://schedule.example.com/
~~~

共有リンクの鍵は初回に自動生成され、起動し直しても同じデータフォルダなら保持されます。リンクを開いた後はHttpOnly/SameSite Cookieで権限を保持し、URLの鍵を消します。編集用・閲覧用の鍵とSQLiteはGitへ入れません。

PUBLIC_ORIGINはURLを検証するための配置設定であり、外部サービスのAPIキーではありません。コードに利用者の個人アカウントは埋め込みません。

## バックアップと別サーバーへの移設

~~~sh
node scripts/backup.mjs export /srv/schedule-data schedule.backup.json
~~~

このJSONは予定・メモ・目標・案件・申請・履歴・設定を含みます。共有リンクの鍵は含みません。新しい設置先でデータを取り込む時は、初回サーバー起動より前に以下を実行します。

~~~sh
node scripts/backup.mjs import /srv/new-schedule-data schedule.backup.json
~~~

既存データを置換する場合はサーバーを止めてから--replaceを明示します。置換前のJSONをデータフォルダ内のbackupsへ保存します。データを移せば実行先の変更は可能ですが、URLが変わる場合は利用者へ新URLを共有します。

リンクの権限を保った復旧には.access-links.jsonも安全に移します。実行中のSQLiteファイルだけをコピーするとWAL分が欠ける可能性があります。JSON書出しを使うか、プロセス停止後にデータフォルダ全体をバックアップします。バックアップ・復旧を実行する管理者の役割までなくなるものではありません。

## Dockerのデータ

compose.yamlのschedule-dataボリュームへ保存します。コンテナの作り直しではボリュームを保持します。docker compose down -vなどボリュームを削除する操作はデータを消します。

データをコンテナの一時ファイル領域へ置くだけの無料ホスティングは使いません。配置先の永続ディスクと費用条件を確認します。無料・無停止・復旧不要のサーバーを、この配布物が自動で提供するわけではありません。
