import { App } from './ui/app';
import { SAMPLES } from './data/samples';

const app = new App();
void app.selectSample(SAMPLES[0]!.id);
