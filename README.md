# agent-media CLI

**AI UGC & video generation from your terminal. Script-to-video pipeline with talking heads, B-roll, voiceover, and animated subtitles.**

[![npm version](https://img.shields.io/npm/v/agent-media-cli)](https://www.npmjs.com/package/agent-media-cli)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

agent-media CLI is a command-line tool for AI UGC video production. It connects to multiple AI providers through a single interface — no separate API keys needed.

## Install

```bash
npm install -g agent-media-cli
```

## Quick Start (60 seconds)

```bash
# 1. Log in
agent-media login

# 2. Generate a UGC video from a script
agent-media ugc "Ever wonder why some videos go viral?" --sync

# 3. Add subtitles to any video
agent-media subtitle ./video.mp4 --style hormozi --sync
```

## UGC Pipeline

The flagship feature — turn any script into a complete video:

- Script → scene splitting → TTS voiceover → AI talking heads → AI B-roll → crossfade assembly → animated subtitles → background music → end screen CTA
- 200+ pre-made AI actors with face + voice
- 7 subtitle styles: hormozi, tiktok, neon, bold, karaoke, minimal, clean

```bash
# UGC with an AI actor
agent-media ugc "your script..." --actor naomi --style hormozi --sync

# UGC with product screenshots as B-roll
agent-media ugc "your script..." --actor sofia --broll --broll-images url1,url2 --sync
```

## SaaS Review Videos

Generate AI review videos for any SaaS product — provide name + screenshots:

```bash
agent-media review --saas "Postiz" --screenshots url1.png,url2.png --actor naomi --sync
```

## All Commands

```bash
agent-media ugc "script..."                # Generate UGC video
agent-media review --saas "Name" ...       # Generate SaaS review video
agent-media actor list                     # Browse 200+ AI actors
agent-media list                           # List your jobs
agent-media list --status completed        # Filter by status
agent-media download <job-id>              # Download completed media
agent-media status <job-id>                # Check job status
agent-media credits                        # View credit balance
agent-media models                         # List all models
agent-media pricing                        # Show credit costs
agent-media plan                           # Show current plan
agent-media subscribe                      # Subscribe or buy credits
agent-media subscribe --plan starter       # Direct plan checkout
agent-media subscribe --credits 500        # Buy a credit pack
agent-media subscribe --manage             # Open billing portal
agent-media apikey list                    # Manage API keys
agent-media doctor                         # Run diagnostics
agent-media help                           # Show all commands
```

## Pricing

| Plan | Price | Credits/month |
|------|-------|---------------|
| Creator | $39/mo | 2,500 |
| Pro | $69/mo | 5,000 |
| Pro Plus | $129/mo | 10,000 |

80 credits/sec — ~800 credits per 10s video. Creator plan limited to 10s max. Pay-as-you-go credit packs also available. See [agent-media.ai](https://agent-media.ai) for details.

## Links

- [Website & Docs](https://agent-media.ai/docs)
- [Showcase](https://agent-media.ai/showcase)
- [GitHub](https://github.com/gitroomhq/agent-media)

## License

Apache 2.0 — see [LICENSE](./LICENSE) for details.
