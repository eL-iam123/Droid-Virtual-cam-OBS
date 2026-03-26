# Virtual Webcam Driver

Virtual Webcam Driver is a Linux desktop app for previewing DroidCam, selecting an OBS output device, viewing logs, and launching OBS from a single UI.

![Dashboard screenshot](docs/screenshots/dashboard.png)

## Fast Setup

Clone the repo, then run:

```bash
npm install
./bin/install-desktop-entry.sh
```

After that, open `Virtual Webcam Driver` from your applications menu.

On first launch, the app opens a terminal and automatically:

- checks dependencies
- installs the desktop launcher if needed
- creates the virtual camera device for OBS if it is missing
- starts the app

When you click `Start Driver`, the app also checks for the virtual camera device and creates it automatically if it is missing.

If you want to start it directly without the applications menu, run:

```bash
./bin/easy-start.sh
```

## What The App Does

- shows a live DroidCam preview
- scans the local network for DroidCam endpoints
- provides built-in profiles
- streams logs into the UI
- launches OBS
- shows which `/dev/videoN` device OBS should use

Profiles are split so the common path stays simple:

- `Recording` is video-only by default
- `Recording + Audio` enables phone audio when ALSA loopback is available

## Requirements

- Linux
- Node.js and npm
- `droidcam-cli`
- `obs` for OBS launch support
- `journalctl` and `systemctl` for optional service-aware telemetry

The app can automatically create a V4L2 loopback device for OBS on first run, but it may ask for your sudo password.
If you choose an audio-enabled profile, the app can also try to create the ALSA loopback device automatically. If that fails, it falls back to video-only mode instead of aborting the stream.

## OBS Setup

If the preview works in the app but OBS shows a frozen or wrong image:

1. Start the driver from the app.
2. Check the output device shown in the UI, for example `/dev/video10`.
3. In OBS, add or edit a `Video Capture Device` source.
4. Select that same `/dev/videoN` device.

## Optional systemd User Service

Copy the example environment file:

```bash
mkdir -p ~/.config/virtual-webcam-driver
cp config/service.env.example ~/.config/virtual-webcam-driver/service.env
```

Install the user unit:

```bash
mkdir -p ~/.config/systemd/user
cp systemd/virtual-webcam-driver.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now virtual-webcam-driver.service
```

## Project Layout

```text
virtual-webcam-driver/
├── app/                 # Electron app code
├── bin/                 # Launch and setup scripts
├── config/              # Profiles, settings, and service env example
├── docs/                # Architecture and screenshot assets
└── systemd/             # Optional user service
```

## License

MIT. See [LICENSE](LICENSE).
