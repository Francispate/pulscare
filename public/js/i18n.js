// Survey + sign-in translations (English, Hindi, Kannada). Full-UI translation is a 70% item.
(function () {
  const T = {
    en: {
      survey_title: 'Tell us how you feel', choose_lang: 'Choose your language', pick_symptoms: 'Select your symptoms',
      suggested: 'Suggested specialist', continue: 'Continue to sign in', none_yet: 'Select a symptom to see a suggested specialist.',
      s_fever: 'Fever and cold', s_chest: 'Chest pain', s_stomach: 'Stomach pain', s_child: 'Child unwell', s_preg: 'Pregnancy care', s_urine: 'Urinary problem', s_injury: 'Injury or lump', s_other: 'Something else'
    },
    hi: {
      survey_title: 'आप कैसा महसूस कर रहे हैं?', choose_lang: 'अपनी भाषा चुनें', pick_symptoms: 'अपने लक्षण चुनें',
      suggested: 'सुझाए गए विशेषज्ञ', continue: 'साइन इन करें', none_yet: 'विशेषज्ञ का सुझाव देखने के लिए कोई लक्षण चुनें।',
      s_fever: 'बुखार और सर्दी', s_chest: 'सीने में दर्द', s_stomach: 'पेट दर्द', s_child: 'बच्चा बीमार है', s_preg: 'गर्भावस्था की देखभाल', s_urine: 'पेशाब की समस्या', s_injury: 'चोट या गांठ', s_other: 'कुछ और'
    },
    kn: {
      survey_title: 'ನಿಮಗೆ ಹೇಗನಿಸುತ್ತಿದೆ?', choose_lang: 'ನಿಮ್ಮ ಭಾಷೆಯನ್ನು ಆರಿಸಿ', pick_symptoms: 'ನಿಮ್ಮ ಲಕ್ಷಣಗಳನ್ನು ಆರಿಸಿ',
      suggested: 'ಸೂಚಿಸಿದ ತಜ್ಞರು', continue: 'ಸೈನ್ ಇನ್ ಮಾಡಿ', none_yet: 'ತಜ್ಞರ ಸಲಹೆ ನೋಡಲು ಒಂದು ಲಕ್ಷಣವನ್ನು ಆರಿಸಿ.',
      s_fever: 'ಜ್ವರ ಮತ್ತು ಶೀತ', s_chest: 'ಎದೆ ನೋವು', s_stomach: 'ಹೊಟ್ಟೆ ನೋವು', s_child: 'ಮಗುವಿಗೆ ಹುಷಾರಿಲ್ಲ', s_preg: 'ಗರ್ಭಾವಸ್ಥೆಯ ಆರೈಕೆ', s_urine: 'ಮೂತ್ರದ ಸಮಸ್ಯೆ', s_injury: 'ಗಾಯ ಅಥವಾ ಗಡ್ಡೆ', s_other: 'ಬೇರೆ ಏನಾದರೂ'
    }
  };
  const I18N = (window.I18N = { lang: sessionStorage.getItem('pc_lang') || 'en', T });
  I18N.t = (k) => (T[I18N.lang] && T[I18N.lang][k]) || T.en[k] || k;
  I18N.set = (lang) => { I18N.lang = lang; sessionStorage.setItem('pc_lang', lang); document.documentElement.lang = lang; I18N.apply(); };
  I18N.apply = () => document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = I18N.t(el.dataset.i18n); });
})();
