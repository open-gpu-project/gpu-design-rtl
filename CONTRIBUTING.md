## For Core Contributors

First, clone this repository:
```sh
git clone https://github.com/open-gpu-project/gpu-design-rtl.git
```
For any changes, create a feature branch following the naming convention `<your name>/<feature name>` for smaller changes or `dev/<feature name>` for bigger changes. For example:
```sh
git checkout -b kevin/minor_doc_fixes
```
Then, commit any changes you have from the branch. Once done, create a PR on **GitHub** following these guidelines:
1. Make sure you have both a reviewer and assigned DRI.
    - Usually, just assign the PR to yourself and request @TheOneKevin to review.
    - If your feature impacts other work, add them to the reviewers.
2. If your PR resolves an issue, mention it in the description (using `#ISSUE_ID` format).
3. Add the project and target milestone if applicable.
4. When merging, squash all commits **unless** it's a major feature, then clean up the commit history using rebase. Remember to leave a useful commit message.
5. Update your kanban board if applicable.
