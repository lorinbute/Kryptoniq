# Sentiq pe Azure App Service

Pașii pentru a publica Sentiq online (FD-AZURE, TD-AZURE §11). Baza de date e deja în Azure SQL (`serento-sql` / `sentiq`, utilizatorul `sentiq_app`); aici se adaugă serverul web. App Service pe Linux e administrat de Microsoft: patch-urile sistemului și ale Node.js le face Microsoft, iar consola se deschide doar din portal, cu login-ul Microsoft. Nu există port SSH deschis spre internet.

## 1. Aplicația web

Portal → **Create a resource → Web App**:

| Câmp | Valoare |
|---|---|
| Resource group | unul nou, de exemplu `sentiq-rg` |
| Name | de exemplu `sentiq-dusty` → adresa `https://sentiq-dusty.azurewebsites.net` |
| Publish | Code |
| Runtime stack | **Node 24 LTS** |
| Operating System | **Linux** |
| Region | aceeași regiune ca serverul `serento-sql` (fiecare interogare face un drum până la bază) |
| Pricing plan | **Basic B2** (3,5 GB; cam dublu față de B1, care costă ~$13 / lună). Pe B1 build-ul nu încape lângă aplicația pornită (§5) |
| Deployment / GitHub Actions | dezactivat (publicarea se face cu zip, §5) |
| Application Insights | opțional (oprit = fără cost în plus) |

## 2. Setările de siguranță

Aplicația → **Settings → Configuration**:

- *General settings*:
  - **Startup Command**: `node src/server/main.ts`
  - **Always On**: On (joburile de fundal rulează fără pauze)
  - **HTTP version**: 2.0
  - **Session affinity**: Off
  - **SCM Basic Auth Publishing Credentials**: Off
  - **FTP Basic Auth Publishing Credentials**: Off
  - **FTP state**: Disabled
- *TLS/SSL* (sau **Settings → Certificates / Custom domains**): **HTTPS Only**: On; **Minimum TLS**: 1.2.
- **Scale out**: o singură instanță (pe Basic e implicit). Cu mai multe, joburile tot rulează o singură dată (TD-AZURE §6), dar nu e nevoie de ele.
- **Monitoring → Health check**: calea `/api/ping`.

## 3. Variabilele de mediu

**Settings → Environment variables → App settings** (aceleași nume ca în `data/database.env`):

| Nume | Valoare |
|---|---|
| `SENTIQ_DB_SERVER` | `serento-sql.database.windows.net` |
| `SENTIQ_DB_NAME` | `sentiq` |
| `SENTIQ_DB_USER` | `sentiq_app` |
| `SENTIQ_DB_PASSWORD` | parola lui `sentiq_app` (recomandat ca referință Key Vault, mai jos) |
| `SENTIQ_MASTER_KEY` | conținutul fișierului `data/master.key` de pe Mac (un rând base64). **Aceeași cheie**, altfel cheile de exchange salvate nu se mai pot citi. |
| `NODE_ENV` | `production` |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `true` (Azure face build-ul pe Linux, deci modulele native primesc binarele potrivite) |
| `CUSTOM_BUILD_COMMAND` | `bash scripts/azure-build.sh`. Fără el, build-ul pică („vite: not found”): cu `NODE_ENV=production`, Azure nu instalează pachetele de build. Scriptul le instalează, face build-ul și apoi le scoate. |
| `SENTIQ_PUBLIC_URL` | `https://domeniul-ales` (după §6; până atunci lipsește) |

Secretele (`SENTIQ_DB_PASSWORD`, `SENTIQ_MASTER_KEY`) pot sta într-un **Key Vault**:

1. Creezi un Key Vault cu RBAC.
2. Pui secretele în el.
3. Aplicației îi dai *Identity → System assigned: On* și rolul *Key Vault Secrets User* pe vault.
4. Valoarea setării devine `@Microsoft.KeyVault(SecretUri=https://<vault>.vault.azure.net/secrets/<nume>/)`.

Fără Key Vault, App Service păstrează setările criptate, dar oricine are acces la aplicație în portal le poate vedea.

Nu e nevoie de `PORT` (îl dă Azure) și nici de `SENTIQ_DATA_DIR`: în Azure, Sentiq ține modelul de sentiment și jurnalele în `/home/data`, care rămâne între publicări.

## 4. Accesul la baza de date

Serverul `serento-sql` → **Security → Networking → Firewall rules**: adaugi **toate** IP-urile din aplicație → **Properties → Outbound IP addresses**, câte o regulă pe IP. Aplicația iese spre bază prin oricare dintre ele: cu unul singur, conectarea merge doar uneori.

Lista se poate vedea și din terminal: `az webapp show -g <grup> -n <aplicație> --query outboundIpAddresses -o tsv`.

Varianta mai largă e „Allow Azure services and resources to access this server”, care deschide portul oricărui serviciu din Azure (parola rămâne obligatorie). Firewall-ul e la nivel de server, deci regulile se aplică și bazelor Serento.

## 5. Publicarea codului

De pe Mac, o dată:

```
brew install azure-cli
az login
```

La fiecare publicare, din folderul proiectului:

```
rm -f ../sentiq.zip
zip -r ../sentiq.zip . -x 'node_modules/*' 'data/*' 'dist/*' '.git/*' '*.app/*' '.npm-cache/*' '.claude/*' '*.DS_Store'
```

Apoi arhiva se urcă după procedura de mai jos (aplicația oprită, deploy, pornire).

`rm -f` e necesar: fără el, `zip` adaugă la arhiva veche, iar fișierele șterse din proiect rămân în ea. Build-ul pe Azure durează câteva minute (`npm ci` + `vite build`).

`data/` nu se urcă niciodată (conexiunea și cheia master sunt în setările de la §3). Jurnalul pornirii: aplicația → **Log stream**.

**Un build întrerupt oprește site-ul.** Build-ul începe prin a șterge `oryx-manifest.toml` din `wwwroot`. Fișierul acesta spune la pornire să se dezarhiveze `node_modules.tar.zst`. Dacă Kudu repornește la jumătatea build-ului (o setare schimbată, Azure mută aplicația pe alt worker), deploy-ul rămâne „în lucru”, iar aplicația nu mai pornește la repornirea următoare (`exit code 1`, fără nimic în jurnalul Sentiq). Ce se face:
1. Se verifică: `/api/deployments/latest` în Kudu arată `Running oryx build...` fără să avanseze, iar în Kudu nu rulează niciun `npm`.
2. Se șterge lacătul rămas: `rm -rf /home/site/locks/deployment` (Kudu → consolă; altfel expiră singur după 40 de minute).
3. Se publică din nou aceeași arhivă (`az webapp deploy … --async true`).
(14 oct 2026: site-ul a fost căzut 12:11–12:27 și 14:16–14:24 UTC din cauza asta.)

**De ce se întrerupe build-ul:** pe B1 (1,75 GB) aplicația pornită (cu modelul de sentiment) și build-ul (`npm ci` + `vite`) nu încap împreună în memorie: Azure repornește instanța în mijlocul build-ului. Ambele deploy-uri care au reușit pe 14 oct au rulat cu aplicația deja oprită. **Procedura de publicare (FD-DBHEAL §2):** aplicația se oprește întâi, ca build-ul să aibă memorie și să nu ruleze două containere deodată:

```
az webapp stop --resource-group DE-SQL-RG --name sentiq
az webapp deploy --resource-group DE-SQL-RG --name sentiq --src-path ../sentiq.zip --type zip --async true
az webapp start --resource-group DE-SQL-RG --name sentiq
```

Comanda `az webapp deploy` nu se termină singură (așteaptă pornirea site-ului, care e oprit): `az webapp start` se dă când Kudu → `/api/deployments/latest` arată `status 4` și `complete true`. Prima publicare așa (14 oct 2026, 15:10–15:21 UTC) a mers fără întrerupere.

O pauză planificată de câteva minute e mai bună decât o cădere la jumătatea build-ului.

**Din 14 oct 2026 seara, planul e B2** (3,5 GB; utilizatorul l-a schimbat; aplicația a repornit singură la 16:27 UTC, fără erori). Build-ul are loc lângă aplicația pornită, deci **publicarea nu mai oprește aplicația**:

```
az webapp deploy --resource-group DE-SQL-RG --name sentiq --src-path ../sentiq.zip --type zip --async true
```

- Se urmărește Kudu → `/api/deployments/latest` până la `status 4` și `complete true`; la final aplicația repornește singură pe codul nou, iar comanda `az` se termină singură. Prima publicare pe B2 (14 oct 2026, deploy `d6965246`): build în 1,7 minute, `/api/ping` cu 200 pe toată durata, codul nou pornit la 17:01:34 UTC.
- Se verifică: „Sentiq running” în jurnalul Sentiq, `/api/ping` cu 200, niciun lacăt rămas în bază.
- Dacă un build tot se întrerupe (Kudu repornit, aplicația mutată pe alt worker): pașii de mai sus (lacătul din `/home/site/locks/deployment`), iar ca rezervă procedura cu `az webapp stop` / `start`.

**16 oct 2026: s-a întâmplat și pe B2.** Build-ul pornit la 22:08 UTC cu aplicația pornită a fost oprit de o repornire a Kudu (~22:11; joburile aplicației vechi dădeau timeout-uri chiar atunci). Manifestul fusese deja șters, deci aplicația nu a mai pornit (`Cannot find package 'mssql'`), iar Azure a blocat-o după pornirile eșuate. Site-ul a fost căzut 22:11–22:27 UTC. Reparat cu procedura cu aplicația oprită: lacătul șters, aceeași arhivă publicată din nou, build în 3,5 minute, `az webapp start`. **De acum, publicarea se face mereu cu aplicația oprită** (`stop` → `deploy` → `start` după `status 4`): câteva minute de pauză planificată în loc de riscul unei căderi.

**18 oct 2026: planul e din nou B1** (`az appservice plan show` → `B1`). Publicarea `d7f4b886` s-a făcut cu aplicația oprită (build 17:46–17:50 UTC, neîntrerupt). Pauza a ținut până la 18:13 UTC, pentru că urmărirea stării a rămas fără răspuns: comenzile `az` de urmărire trebuie să poată ieși în rețea.

Capcane la urmărire:
- `az webapp deploy` poate spune „Deployment has completed successfully” deși build-ul încă rulează (endpoint-ul lui de stare a dat timeout). Se crede doar Kudu → `/api/deployments/latest` (`az rest --method get --uri "https://<scm>/api/deployments/latest" --resource https://management.azure.com/`).
- Kudu scrie `"complete": true` cu literă mică.
- Cât Azure e oprit, joburile le ia Mac-ul. Dacă publicarea schimbă schema bazei, Mac-ul se repornește imediat după ce Azure a pornit pe codul nou (`scripts/sentiq.sh restart`), altfel ține joburile cu codul vechi.

## 6. Domeniul

1. Aplicația → **Custom domains → Add custom domain**.
2. Pui recordurile cerute (CNAME + TXT) la furnizorul DNS.
3. Alegi **App Service Managed Certificate** (gratuit) și legătura SNI.
4. Setezi `SENTIQ_PUBLIC_URL=https://domeniul` (§3).

Domeniul Sentiq: **`sentiq.money`** (legat de utilizator pe 14 oct 2026, cu certificat SNI), `SENTIQ_PUBLIC_URL=https://sentiq.money`.

Legat de domeniu:
- **Passkey-urile sunt legate de domeniu**: cele făcute pe `localhost` nu merg pe adresa nouă. Fiecare își adaugă unul nou în Securitate, după ce intră cu parola și 2FA.
- La pornire, aplicația scrie adresa publică în bază; Mac-ul o folosește pentru linkurile de activare (FD-ONLINE §2).
- Adresa `*.azurewebsites.net` merge și ea, dar un passkey făcut acolo nu merge pe domeniu. De aceea, passkey-urile se fac doar după ce domeniul e gata.

## 7. După publicare

- Pe Mac, Sentiq poate rămâne pornit pe aceeași bază: joburile le rulează doar una dintre instanțe (Stare sistem → „Joburi de fundal”). Prima parolă de admin și `admin-reset` se fac în continuare de pe Mac (FD-AZURE §4).
- Connectorul MCP nu mai există (scos pe 14 oct 2026, FD-MCPREMOVE); setarea `SENTIQ_MCP` a fost ștearsă din App Service.
- Cost aproximativ: App Service B2 (cam dublu față de B1, care costă ~$13 / lună), plus baza (Basic ~$5, S0 ~$15).
