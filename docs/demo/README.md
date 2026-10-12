# Demo assets

`alex.jpg` is the profile photo of **Alex**, one of the two fictional people in the demo data
(`scripts/seed_demo.py` and the browser demo built by `scripts/build_demo.py`). It is not a
photo of a real person: it was generated with OpenAI's image API (`gpt-image-2`, 1024x1024,
quality "high") and scaled down to a 512x512 JPEG, the same size the dashboard uses for
uploaded photos.

Prompt:

> Photorealistic portrait photo of a fictional, entirely made-up man in his early thirties, an
> ordinary everyday person who is not any real or famous individual. Friendly, relaxed natural
> smile, looking at the camera. Short dark brown hair, light stubble, plain heather-grey
> crew-neck t-shirt. Framed from the shoulders up, head centered in a square frame with some
> space above the head. Plain, soft, evenly lit light grey-green studio background, soft
> natural light, shallow depth of field, sharp focus on the eyes. Natural skin texture, no
> retouching look. No text, no logos, no watermark, no jewelry, no glasses.

Sam, the other demo profile, keeps the initials avatar.

The weekly analysis in `docs/screenshots/dashboard-*.png` and `analysis.gif` was written by
`gpt-5.4-mini` from the same fictional data (`scripts/seed_demo.py`). The live demo has no AI
behind it: `demo/demo.js` fills fixed sentences with the demo's numbers and streams them like
a model would.
