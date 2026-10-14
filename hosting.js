document.addEventListener('DOMContentLoaded', () => {
  // INDIVIDUAL HOST REGISTRATION
  const personForm = document.getElementById('person-host-form');
  const personMessage = document.getElementById('person-host-success');

  if (personForm && personMessage) {
    personForm.addEventListener('submit', (event) => {
      event.preventDefault();

      personMessage.style.display = 'block';
      personMessage.textContent = '';
      personMessage.className = 'success';

      if (!personForm.reportValidity()) {
        return;
      }

      const country = document.getElementById('country');
      const username = document.getElementById('username');
      const fullname = document.getElementById('fullname');
      const birthdate = document.getElementById('birthdate');
      const idType = document.getElementById('id-type');
      const idFile = document.getElementById('id-file');

      // Confirm the required fields exist.
      if (
        !country ||
        !username ||
        !fullname ||
        !birthdate ||
        !idType ||
        !idFile
      ) {
        showMessage(
          personMessage,
          'Some registration fields are missing. Please check the form.',
          'error'
        );
        return;
      }

      // Validate date of birth.
      const dob = new Date(birthdate.value + 'T00:00:00');
      const today = new Date();

      if (Number.isNaN(dob.getTime()) || dob >= today) {
        showMessage(
          personMessage,
          'Please enter a valid date of birth.',
          'error'
        );
        birthdate.focus();
        return;
      }

      let age = today.getFullYear() - dob.getFullYear();
      const monthDifference = today.getMonth() - dob.getMonth();

      if (
        monthDifference < 0 ||
        (monthDifference === 0 && today.getDate() < dob.getDate())
      ) {
        age--;
      }

      if (age < 18) {
        showMessage(
          personMessage,
          'You must be at least 18 years old to continue with this host registration demo.',
          'error'
        );
        birthdate.focus();
        return;
      }

      // Validate identity document selection.
      const allowedTypes = [
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/pdf'
      ];

      const selectedFile = idFile.files[0];

      if (!selectedFile) {
        showMessage(
          personMessage,
          'Please select an identity document file.',
          'error'
        );
        idFile.focus();
        return;
      }

      if (!allowedTypes.includes(selectedFile.type)) {
        showMessage(
          personMessage,
          'Choose a JPG, PNG, WebP, or PDF document.',
          'error'
        );
        idFile.focus();
        return;
      }

      // Limit the demo file selection to 10 MB.
      if (selectedFile.size > 10 * 1024 * 1024) {
        showMessage(
          personMessage,
          'The selected file is too large. Choose a file smaller than 10 MB.',
          'error'
        );
        idFile.focus();
        return;
      }

      // Save registration text for the local admin-review prototype only.
      // The selected certificate itself is NOT uploaded or stored.
      const draft = {
        country: country.value,
        username: username.value.trim(),
        fullname: fullname.value.trim(),
        birthdate: birthdate.value,
        email: (document.getElementById('email') || {}).value || '',
        phone: (document.getElementById('phone') || {}).value || '',
        idType: idType.value,
        idNumber: (document.getElementById('id-number') || {}).value || '',
        address: (document.getElementById('address') || {}).value || '',
        identityFileName: selectedFile.name,
        selfieFileName: ((document.getElementById('selfie-file') || {}).files || [])[0]?.name || '',
        submittedAt: new Date().toISOString(),
        status: 'Pending review'
      };
      try {
        localStorage.setItem('joint_person_host_registration_draft', JSON.stringify(draft));
      } catch (error) {
        showMessage(personMessage, 'Browser storage could not save this demo draft. No document was uploaded.', 'error');
        return;
      }
      showMessage(
        personMessage,
        'Form checks passed and a text-only draft was saved in this browser for demo review. Your ID certificate has NOT been uploaded or verified. A secure upload and identity-verification service is still required.',
        'success'
      );

      personMessage.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      });
    });
  }

  // ORGANIZATION REGISTRATION
  // The organization form can use the ID "organization-form"
  // and its message element can use "organization-success".
  const organizationForm = document.getElementById('organization-form');
  const organizationMessage = document.getElementById('organization-success');

  if (organizationForm && organizationMessage) {
    organizationForm.addEventListener('submit', (event) => {
      event.preventDefault();

      if (!organizationForm.reportValidity()) {
        return;
      }

      showMessage(
        organizationMessage,
        'Organization form checks passed. This is a demo: no organization details or documents have been saved or verified yet.',
        'success'
      );

      organizationMessage.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      });
    });
  }

  function showMessage(element, message, type) {
    element.textContent = message;
    element.style.display = 'block';

    element.classList.remove('success', 'error');
    element.classList.add(type);

    element.setAttribute('role', 'status');
  }
});