/**
 * AI Service - يستدعي نموذج ذكاء اصطناعي حقيقي (Grok / OpenAI-compatible)
 *
 * ضع المفتاح في .env:
 *   AI_API_KEY=your_key
 *   AI_PROVIDER=grok   # أو openai
 *   AI_BASE_URL=       # اختياري
 *   AI_MODEL=          # اختياري
 */

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIResponse {
  content: string;
  model?: string;
}

function getConfig() {
  const provider = (process.env.AI_PROVIDER || 'grok').toLowerCase();
  const apiKey = process.env.AI_API_KEY || '';

  // Grok (xAI) uses OpenAI-compatible API
  if (provider === 'grok' || provider === 'xai') {
    return {
      baseUrl: process.env.AI_BASE_URL || 'https://api.x.ai/v1',
      model: process.env.AI_MODEL || 'grok-3',
      apiKey,
      provider: 'grok',
    };
  }

  // OpenAI
  return {
    baseUrl: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.AI_MODEL || 'gpt-4o-mini',
    apiKey,
    provider: 'openai',
  };
}

/**
 * استدعاء نموذج الدردشة
 */
export async function chatCompletion(messages: AIMessage[]): Promise<AIResponse> {
  const config = getConfig();

  if (!config.apiKey) {
    throw new Error(
      'لم يتم ضبط AI_API_KEY. أضف المفتاح في ملف .env لتفعيل المساعد الذكي الحقيقي.'
    );
  }

  const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0.3,
      max_tokens: 2000,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`AI API error ${res.status}: ${errText.substring(0, 300)}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('لم يُرجع النموذج أي محتوى');
  }

  return {
    content,
    model: data.model || config.model,
  };
}

/**
 * بناء رسالة النظام للمساعد القانوني
 */
export function buildLegalSystemPrompt(context: string): string {
  return `أنت مساعد قانوني متخصص في التشريع والاجتهاد القضائي (خصوصاً القانون الجزائري والعربية).
مهمتك:
- الإجابة بدقة ووضوح باللغة العربية الفصحى
- الاعتماد أساساً على المصادر المقدمة أدناه
- ذكر المراجع (رقم القانون أو رقم القرار) عند الإمكان
- إذا لم تكن المعلومات كافية في المصادر، وضّح ذلك ولا تختلق نصوصاً
- أضف في نهاية الإجابة: «هذه الإجابة لأغراض إعلامية ولا تُعتبر استشارة قانونية ملزمة.»

المصادر المتاحة من منصة Jurithèque:
----------------
${context || 'لا توجد مصادر مسترجعة لهذا السؤال.'}
----------------`;
}
