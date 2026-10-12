import { Config } from "@remotion/cli/config";

// ANGLE gives the headless browser a real WebGL implementation for the three.js scenes.
Config.setChromiumOpenGlRenderer("angle");
Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(95);
Config.setCodec("h264");
Config.setCrf(18);
