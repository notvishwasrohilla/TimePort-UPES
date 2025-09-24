(() => {
  // This script is injected into the webpage
  // 1. Select the container that holds all the class sessions.
  const sessionsContainer = document.querySelector('app-session-info ul');

  // If the container doesn't exist, we're not on the right page.
  if (!sessionsContainer) {
    return [];
  }

  // 2. Grab all the individual session items.
  const allSessions = sessionsContainer.querySelectorAll('li.course-red-wrapper');

  // 3. Create an array to store the extracted data.
  const scheduleData = [];

  // 4. Loop through each session element to extract its details.
  allSessions.forEach(sessionElement => {
    const courseNameEl = sessionElement.querySelector('b');
    const timeParagraph = sessionElement.querySelector('p');
    
    // Ensure the elements exist before trying to read them
    if (courseNameEl && timeParagraph) {
        const courseName = courseNameEl.innerText;

        // Clone the paragraph to safely remove the link part for text extraction
        const paragraphClone = timeParagraph.cloneNode(true);
        const linkSpan = paragraphClone.querySelector('span');
        if (linkSpan) {
            linkSpan.remove(); // Remove the span containing the link
        }
        const sessionTime = paragraphClone.innerText.trim(); // Get the remaining text

        scheduleData.push({
            name: courseName,
            time: sessionTime,
        });
    }
  });

  // 5. Return the data to the popup script.
  return scheduleData;
})();
