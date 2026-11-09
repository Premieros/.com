# Premier OS login motion — pending video handoff

This branch implements the login experience without waiting on a video deliverable.

## Completed
- Official-inspired geometric Premier P as a reusable vector component (mark and wordmark), plus browser/PWA icons.
- Dark violet landing page and top-bar sign-in action.
- Accessible sign-in dialog with PIN, username, email/password, registration link, Escape key and focus trapping. Existing auth handlers and permission boundaries are unchanged.
- CSS fallback animation: pixel-formed P and rotating genuine in-repository POS, reports and dashboard images.
- Reduced-motion support, responsive layout and Arabic/English content.

## Only remaining creative asset
Place the final approved silent MP4 here:

`public/auth/premier-login-motion.mp4`

Requirements:
- MP4 / H.264, 16:9, recommended 1920×1080, about 8 seconds
- Silent, seamless loop, optimized for browser streaming
- Preserve Premier P geometry and the violet dot; screenshots are real product interfaces
- Keep the center adequately clear so sign-in dialog remains readable
- Do not embed username/password fields or functional UI into the video

The motion hero automatically shows the MP4 after `canplay`. If video is missing or fails to load, the CSS-based pixel and product showcase remains visible. The auth logic never depends on the video file.

## Release guardrails
Do not merge or promote before CI tests, manual layout/accessibility review and approved-video integration. No production database changes are required.
