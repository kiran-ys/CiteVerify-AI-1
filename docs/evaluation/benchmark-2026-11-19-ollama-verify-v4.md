# CiteVerify reasoning benchmark — 2026-11-19

- Commit: `37c95e7` (plus uncommitted changes if any) · Provider: ollama · Model: `llama3.2`
- Cases: 48 (38 real claims, 10 deliberately altered). Evidence snapshot captured 2026-11-19.
- **Label status: 0 human-reviewed, 48 provisional (AI-assisted).** These numbers measure agreement with provisional labels, not scientific accuracy.

## Summary

| Metric | Value |
| --- | --- |
| Overall accuracy | 16/48 (33.3%) |
| Accuracy, clear cases | 9/27 (33.3%) |
| Accuracy, borderline cases | 7/21 (33.3%) |
| Accuracy, real claims | 13/38 (34.2%) |
| Accuracy, altered claims | 3/10 (30.0%) |
| Macro precision / recall / F1 | 0.26 / 0.35 / 0.29 |
| Unable-to-verify rate (predicted) | 12.5% |
| Invalid model output rate | 2.2% of model calls |
| API failures / timeouts / rate limits | 0 / 0 / 0 |
| Evidence citation validity (positive verdicts citing only stored source text) | 100.0% of 35 |
| Average latency per model-judged claim | 9.5 s |

## Per verdict

| Verdict | Cases | Precision | Recall | F1 |
| --- | --- | --- | --- | --- |
| Supported | 16 | 0.00 | 0.00 | 0.00 |
| Partially supported | 16 | 0.36 | 0.63 | 0.45 |
| Contradicted | 5 | 0.14 | 0.20 | 0.17 |
| Unsupported | 5 | 0.29 | 0.40 | 0.33 |
| Unable to verify | 6 | 0.50 | 0.50 | 0.50 |

## Confusion matrix (rows: expected, columns: predicted)

| | Supported | Partially supported | Contradicted | Unsupported | Unable to verify |
| --- | --- | --- | --- | --- | --- |
| **Supported** | 0 | 15 | 0 | 0 | 1 |
| **Partially supported** | 0 | 10 | 2 | 3 | 1 |
| **Contradicted** | 0 | 3 | 1 | 0 | 1 |
| **Unsupported** | 0 | 0 | 3 | 2 | 0 |
| **Unable to verify** | 0 | 0 | 1 | 2 | 3 |

## Misses

- `real/PMC7065031/claim-005` (Supported, clear): expected **Supported**, got **Partially supported**. The population is correctly identified as postmenopausal women, but the intervention (menopause) and finding (impaired vascular endothelial function) are not directly stated in the evidence passages. The outcome (flow-mediated dilation) is supported, but the d
- `real/PMC7065031/claim-008` (Supported, clear): expected **Supported**, got **Partially supported**. The claim attributes the population to individuals with CVD risk and hypertension, but the evidence passages study patients with type 2 diabetes. The intervention is aerobic exercise training, which contradicts the claim's focus on endothelial function in CVD 
- `real/PMC7065031/claim-009` (Supported, clear): expected **Supported**, got **Partially supported**. The claim's population and outcome are supported by the evidence passages, but the finding is contradicted. The intervention (aerobic exercise) is not mentioned in any of the passages.
- `real/PMC7065031/claim-023` (Supported, clear): expected **Supported**, got **Partially supported**. The claim attributes the study to healthy subjects, but the evidence passages only mention postmenopausal women. The outcome and finding are also not reported in the evidence passages.
- `real/PMC7065031/claim-024` (Supported, clear): expected **Supported**, got **Partially supported**. The study found improvement in FMD for postmenopausal women, but the direction of change was opposite to what Pierce et al. reported. The intervention and population match the claim's subject, but the outcome does not support the claim's finding.
- `real/PMC7065031/claim-026` (Supported, clear): expected **Supported**, got **Unable to verify** — failure: invalid_output. The model's answer was rejected because the model did not return valid JSON (and again on one retry: the model did not return valid JSON).
- `real/PMC7065031/claim-028` (Supported, borderline): expected **Supported**, got **Partially supported**. The study population and outcome are supported, but the finding is contradicted by E3. The intervention is not reported in any of the evidence passages.
- `real/PMC7065031/claim-030` (Supported, borderline): expected **Supported**, got **Partially supported**. The study population is post-menopausal women with elevated blood pressure, but the intervention (exercise) is not mentioned. The outcome (endothelial dysfunction) is found in some studies, while others do not report it. The finding that approximately 70% of e
- `real/PMC7065031/claim-032` (Supported, clear): expected **Supported**, got **Partially supported**. The claim's population and outcome are supported by the evidence, but the finding is contradicted. The intervention (exercise training) is not reported in any of the passages. The topic match indicates that the cited source studies a related question about end
- `real/PMC7065031/claim-034` (Supported, clear): expected **Supported**, got **Partially supported**. The claim states that FMD uncorrected for shear is associated with CVD risk, but E10 shows that FMD remains a significant predictor of cardiovascular events after adjustment for various factors, suggesting no direct association between FMD and CVD risk.
- `real/ioannidis-2005/claim-001` (Partially supported, borderline): expected **Partially supported**, got **Unsupported**. The claim discusses refutation and controversy across various research designs, but the evidence passages only discuss genetic association studies and do not address clinical trials or traditional epidemiological studies. The passages also do not provide infor
- `real/ioannidis-2005/claim-002` (Partially supported, borderline): expected **Partially supported**, got **Contradicted**. The claim attributes the study of false findings in modern research to a specific population, intervention, and outcome, but none of these are mentioned in the evidence passages. The only finding related to the topic is that a sizeable proportion of identified
- `real/ioannidis-2005/claim-003` (Supported, borderline): expected **Supported**, got **Partially supported**. The claim attributes a study on the high rate of nonreplication to the strategy of claiming conclusive research findings solely on the basis of a single study assessed by formal statistical significance. However, the evidence passages do not mention population
- `real/ioannidis-2005/claim-004` (Supported, clear): expected **Supported**, got **Partially supported**. The claim attributes a study to the probability of a research finding being true, but the evidence passages discuss genetic determinants and molecular methods without mentioning this specific topic. The passages do provide information on statistical significan
- `real/ioannidis-2005/claim-005` (Supported, borderline): expected **Supported**, got **Partially supported**. The population is not specified, the intervention (P value) is contradicted by the passage stating that declaring statistical significance based on a P value alone can lead to false positives. The outcome (probability of no true association) and finding (FPRP-
- `real/ioannidis-2005/claim-008` (Unable to verify, borderline): expected **Unable to verify**, got **Unsupported**. The claim attributes large studies to being more reliable, but the evidence passages only discuss validating prognostic models and do not mention study size or reliability. The passages are related background, but they do not support the claim's specific asser
- `real/ioannidis-2005/claim-009` (Unable to verify, borderline): expected **Unable to verify**, got **Unsupported**. The passages do not discuss the impact of smoking on cancer or cardiovascular disease, nor do they provide information about relative risks. They focus on genetic risk factors for multigenetic diseases instead.
- `real/ioannidis-2005/claim-010` (Partially supported, borderline): expected **Partially supported**, got **Unable to verify**. The claim attributes a study to high-throughput discovery-oriented research, but the evidence passages do not discuss population, intervention, or outcome. They only mention gene expression profiling and cancer classification, which are related background topi
- `real/ioannidis-2005/claim-011` (Supported, clear): expected **Supported**, got **Partially supported**. The claim is partially supported because the population and outcome are mentioned, but the intervention and finding are not. The topic match indicates that the evidence passages discuss the standardization of research designs and reporting, which is related to
- `real/ioannidis-2005/claim-014` (Supported, borderline): expected **Supported**, got **Partially supported**. The claim states that conflicts of interest are very common in biomedical research, but the evidence passages do not directly state this. However, they do report on the prevalence of financial interests among authors and the inadequacy of reporting these inter
- `real/ioannidis-2005/claim-015` (Partially supported, borderline): expected **Partially supported**, got **Unsupported**. The claim attributes the study to expert opinion, but the evidence passages are about the relationship between accumulating data from randomized control trials and recommendations of clinical experts. The passages do not discuss expert opinions or reliability.
- `real/ioannidis-2005/claim-016` (Supported, clear): expected **Supported**, got **Partially supported**. The passages discuss the Proteus phenomenon in molecular genetics research but do not directly address the claim about extreme opposites being common in molecular genetics. The studies focus on the characteristics of early contradictory estimates rather than t
- `real/ioannidis-2005/claim-018` (Partially supported, borderline): expected **Partially supported**, got **Unsupported**. The claim attributes a whole genome association study to testing gene polymorphisms for schizophrenia susceptibility, but the evidence passages discuss DNA microarrays and cancer outcomes, not genetic associations with psychiatric disorders. The passages do pr
- `real/ioannidis-2005/claim-024` (Unable to verify, borderline): expected **Unable to verify**, got **Contradicted**. The passages discuss the limitations of P-values, but do not address the specific finding that extremely large studies may be more likely to find a statistically significant difference for a trivial effect. The evidence does not support the claim's finding, an
- `real/ioannidis-2005/claim-028` (Partially supported, borderline): expected **Partially supported**, got **Contradicted**. The passages discuss the frequency of contradiction and stronger effects in highly cited clinical research, but do not address specific 'classics' or their test results. The claim's subject is unclear from the provided evidence.
- `altered/01-contradicted-direction` (contradicted-direction, clear): expected **Contradicted**, got **Partially supported**. The study found improvement in FMD in postmenopausal women, but no improvement in older men. The population and outcome are supported, but the finding is contradicted by E3. Additionally, the intervention is not reported in any of the evidence passages.
- `altered/03-contradicted-population` (contradicted-population, clear): expected **Contradicted**, got **Unable to verify**. The passages do not provide direct support for the claim, and instead discuss the Proteus phenomenon in molecular genetics research. The studies focus on the sequence of extreme opposite results in retrospective hypothesis-generating research, but do not addre
- `altered/04-numerical-error` (numerical-error, clear): expected **Contradicted**, got **Partially supported**. The claim states that conflicts of interest are rare, but the evidence passages do not directly support this finding. However, they do provide information on the prevalence of financial interests among authors (E3 and E4), which is related to the claim's subje
- `altered/05-numerical-error` (numerical-error, clear): expected **Contradicted**, got **Partially supported**. The population is not specified, but the outcome (significant associations) and finding (9.7 times more likely per doubling of sample size) are supported by one passage. The intervention (microarray probes increase) is contradicted by another passage. The topi
- `altered/06-miscitation` (miscitation, clear): expected **Unsupported**, got **Contradicted**. The claim's population and outcome are not reported in the evidence passages. The intervention is also contradicted by one of the passages, which states that rapid early sequences of extreme opposite results are frequent in retrospective hypothesis-generating 
- `altered/07-miscitation` (miscitation, clear): expected **Unsupported**, got **Contradicted**. The evidence passages discuss the transfer of new statistical methods into medical journals, but do not address molecular genetics or extreme opposite results. The finding that contradicts the claim is about the time it takes for technical innovations to achie
- `altered/09-miscitation` (miscitation, clear): expected **Unsupported**, got **Contradicted**. The passages discuss statistical testing methods and their performance, but do not address the relationship between outcome types and finding prevalence in schizophrenia. The evidence does not support or contradict the claim about true findings being more comm
