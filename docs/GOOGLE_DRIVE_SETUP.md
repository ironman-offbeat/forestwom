# 소유자 Google Drive 연결

앱 이용자는 Google 로그인을 하지 않습니다. 소유자가 한 번 승인한 권한으로 Vercel 서버가 전용 폴더에 저장합니다. 링크 편집 권한만으로 Drive API 인증을 대체할 수는 없습니다.

## 이미 준비된 항목

- 전용 폴더: [Forestwom 도면 저장소](https://drive.google.com/drive/folders/1yH_XntqOfSO0m9jJP9hyUh8u3B4JCoqh).
- Vercel 프로젝트: `261 / forestwom`, 배포 주소 `https://forestwom.2hayoung.com`.
- 서버는 위 폴더와 그 바로 아래 저장본만 다룹니다. 다른 Drive 폴더를 요청 본문으로 지정할 수 없습니다.
- 이 전용 폴더는 `링크가 있는 모든 사용자 / 편집자`로 설정했습니다. 저장 시 이 설정을 확인하며, 소유자가 이후 제한하면 임의로 다시 공개하지 않습니다. 전체 내 드라이브는 공유하지 않습니다.

## 소유자가 해야 하는 최초 설정

1. [Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트를 선택하거나 만듭니다. Google Drive API를 활성화합니다. 유료 AI 서비스나 GAS는 사용하지 않습니다.
2. Google Auth Platform에서 앱 이름·지원 이메일·대상 사용자를 설정합니다. 외부 테스트 상태라면 본인 계정을 테스트 사용자에 추가합니다.
3. OAuth 클라이언트 ID를 **데스크톱 앱** 유형으로 만들고 JSON을 다운로드합니다. 이 파일은 저장소 바깥에 보관합니다.
4. 이 저장소에서 다음 명령을 실행합니다. 열린 Google 화면에서는 저장소 소유자 계정으로 승인합니다.

   ```powershell
   node scripts/connect-drive.mjs "C:\Users\offbeat\Downloads\client_secret_....json"
   ```

5. 생성된 로컬 `.env.drive`를 [Vercel 환경 변수 설정](https://vercel.com/261/forestwom/settings/environment-variables)에 가져옵니다. 적용 환경은 **Production**입니다. `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` 세 항목이며 `VITE_` 접두사를 붙이지 않습니다. 채팅·GitHub·스크린샷에 비밀값을 올리지 않습니다.
6. Vercel에서 최신 커밋을 재배포합니다. 앱에서 가상 PDF를 넣고 저장 → 저장소 보기 → 저장한 검토 다시 열기를 시험합니다.

Google OAuth 앱이 외부 **테스트** 상태이면 Drive 범위의 refresh token은 보통 7일 후 만료됩니다. 지속 사용하려면 Google의 게시 상태·검증 요구사항을 확인하고 적용하거나, 만료 후 소유자가 재연결해야 합니다. 이용자 로그인으로 우회하지 않습니다.

현재 폴더는 다른 연결 도구로 만들어졌으므로 소유자 OAuth는 `drive` 범위를 사용합니다. `drive.file`로 줄이려면 동일 OAuth 앱에서 폴더를 새로 만들거나 Picker로 폴더를 승인하는 추가 작업이 필요합니다. 서버 코드의 고정 폴더 제한이 Google 토큰 자체의 범위를 축소하는 것은 아닙니다.

## 저장 동작

`[YYYY-MM-DD] 도면 이름 · HHMMSS-고유번호` 형식으로 한국 시간의 새 폴더를 만듭니다. 원본 PDF, `검토의견서.pdf`, `review.json`을 저장합니다. 동일 이름으로 다시 저장해도 이전 폴더를 덮어쓰지 않습니다.

업로드는 1MB 조각으로 Vercel을 거쳐 Drive로 전송됩니다. 소유자 토큰은 브라우저로 보내지 않습니다. 서버는 완성된 파일의 이름·크기를 대조한 뒤 저장 완료 표시를 붙입니다. 중단된 폴더는 Drive에는 남을 수 있지만 다시 열기 목록에는 표시하지 않습니다. 실패 후 재저장은 새 폴더를 만들며, 미완료 폴더는 Drive에서 직접 정리합니다.

목록은 100개씩 가져옵니다. 다시 열기에서는 JSON 구조와 PDF SHA-256을 확인하고 PDF.js로 원본을 다시 읽습니다. 공개 편집자가 JSON과 원본을 함께 바꾸는 경우까지 진본임을 보장하는 전자서명은 아닙니다. 따라서 수치 확정·적용 기준·승인은 항상 다시 확인합니다.

링크를 가진 사람은 이 폴더 자료를 읽고 수정·삭제할 수 있습니다. 앱 저장 API도 로그인 없이 사용하도록 만든 공개 기능입니다. Origin/CORS 검사는 사용자 인증이나 남용 방지 수단이 아닙니다. 파일당 30MB, 저장본당 원본 10개/100MB 제한은 있지만 누적 저장량·호출량을 통제하는 영구 rate limit은 없습니다. 필요하면 Vercel 방화벽과 Google 저장 공간 정책을 별도로 설정합니다.

## 근거

- [Google 서버 OAuth와 offline access](https://developers.google.com/identity/protocols/oauth2/web-server)
- [OAuth 토큰 만료 조건](https://developers.google.com/identity/protocols/oauth2#expiration)
- [Drive 범위 선택](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Drive 재개 가능한 업로드](https://developers.google.com/workspace/drive/api/guides/manage-uploads)

인증 준비 전에는 UI 배포·로컬 PDF 출력·모의 저장 테스트까지만 확인할 수 있습니다. 실제 Drive 저장 성공으로 보고하지 않습니다.

Drive 웹사이트 자체는 파일 추가·수정 때 Google 로그인을 요구할 수 있습니다. 앱의 저장·다시 열기는 소유자 서버 권한을 사용하므로 이용자 로그인 없이 처리합니다.
