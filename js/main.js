// Jurithèque - Main JavaScript

document.addEventListener('DOMContentLoaded', function () {
  // Mobile menu toggle
  const mobileToggle = document.querySelector('.mobile-toggle');
  const nav = document.querySelector('.nav');

  if (mobileToggle && nav) {
    mobileToggle.addEventListener('click', function () {
      nav.classList.toggle('open');
    });
  }

  // Tabs functionality
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', function () {
      const target = this.dataset.tab;

      tabButtons.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      this.classList.add('active');
      const content = document.getElementById(target);
      if (content) content.classList.add('active');
    });
  });

  // Simple AI Assistant mock
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  const chatMessages = document.getElementById('chat-messages');

  if (chatForm && chatInput && chatMessages) {
    chatForm.addEventListener('submit', function (e) {
      e.preventDefault();
      const message = chatInput.value.trim();
      if (!message) return;

      // User message
      appendMessage(message, 'user');
      chatInput.value = '';

      // Simulate bot response
      setTimeout(() => {
        const responses = [
          'شكراً على سؤالك. بناءً على المعلومات المتوفرة في المنصة، يمكنني توجيهك إلى القسم المناسب. هل تريد تفاصيل أكثر؟',
          'هذا موضوع قانوني مهم. أنصحك بالاطلاع على مدونة القوانين ذات الصلة والاجتهادات القضائية المرتبطة. هل ترغب في البحث عن نص معين؟',
          'المساعد القانوني الذكي جاهز لمساعدتك. حالياً هذه نسخة تجريبية. في النسخة الكاملة سيتم ربطه بمحرك ذكاء اصطناعي متخصص في القانون.',
          'يمكنك العثور على المزيد من المعلومات في قسم المكتبة القانونية أو الاجتهادات القضائية. هل تريد رابطاً مباشراً؟'
        ];
        const randomResponse = responses[Math.floor(Math.random() * responses.length)];
        appendMessage(randomResponse, 'bot');
      }, 800);
    });
  }

  function appendMessage(text, type) {
    const div = document.createElement('div');
    div.className = `message ${type}`;
    div.textContent = text;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  // Active nav link based on current page
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav a').forEach(link => {
    const href = link.getAttribute('href');
    if (href === currentPage || (currentPage === '' && href === 'index.html')) {
      link.classList.add('active');
    }
  });
});
