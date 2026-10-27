import React from 'react';
import { Composition } from 'remotion';
import { Doc, DocProps } from './Doc';
import { Doc2, Doc2Props } from './Doc2';

const fallback: DocProps = {
  timing: { duration: 24, sentences: [{ start: 0.2, end: 4.6 }, { start: 5.1, end: 7.6 }, { start: 8, end: 9.1 }, { start: 9.6, end: 14.4 }, { start: 14.9, end: 17.2 }, { start: 17.7, end: 22.4 }, { start: 22.9, end: 24 }] },
  captions: ['In 2021, seven people who had just left OpenAI started a new AI lab.', 'Five years later, that lab filed to go public.', 'Ticker: ANT.', 'In the first half of 2026, its revenue hit $16.3 billion.', 'A year earlier, it was $1.2 billion.', 'And in its own filing, it warns that its AI could pose catastrophic risks to humanity.', 'This is the story of Anthropic.'],
  assets: { walkout: 'assets/walkout.jpg', dario: 'assets/dario.jpg', voice: null, headline: null, risk: null },
};

const fallback2: Doc2Props = {
  timing: { duration: 30, sentences: [{ start: 0, end: 3 }, { start: 3.3, end: 7.5 }, { start: 7.8, end: 9.2 }, { start: 9.5, end: 14 }, { start: 14.3, end: 16.8 }, { start: 17.1, end: 23.5 }, { start: 23.8, end: 25.6 }, { start: 26, end: 28 }] },
  assets: { voice: null, dario: 'assets/dario.jpg', darioCut: null, darioCredit: 'UK Prime Minister / CC BY 2.0', headline: null, risk: null, nfLogo: 'assets/nf-logo.png', anthropicLogo: 'assets/anthropic.png' },
};

export const Root: React.FC = () => (
  <>
  <Composition
    id="Doc2"
    component={Doc2}
    fps={30}
    width={1920}
    height={1080}
    durationInFrames={900}
    defaultProps={fallback2}
    calculateMetadata={({ props }) => ({ durationInFrames: Math.ceil((props.timing.duration + 2.2) * 30) })}
  />
  <Composition
    id="Doc"
    component={Doc}
    fps={30}
    width={1920}
    height={1080}
    durationInFrames={30 * 26}
    defaultProps={fallback}
    calculateMetadata={({ props }) => ({ durationInFrames: Math.ceil((props.timing.duration + 1.8) * 30) })}
  />
  </>
);
